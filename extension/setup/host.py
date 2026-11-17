#!/usr/bin/env python3
# V2 Client - native messaging host (Python 3.8+, standard library only).
# Designed by Alex Anderson.
#
# Chrome starts this program through the Native Messaging API. It manages the
# Xray core (download / update / start / stop) and runs small network tests.
# Every request is a JSON message; the answer is a JSON message with "ok".

import json, os, sys, struct, socket, subprocess, time, re, platform, hashlib
import zipfile, shutil, tempfile, signal, traceback
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HOST_VERSION = "2.0.0"
IS_WIN = os.name == "nt"

if os.environ.get("V2CLIENT_HOME"):
    HOME = os.environ["V2CLIENT_HOME"]
elif IS_WIN:
    HOME = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "V2Client")
else:
    HOME = os.path.join(os.path.expanduser("~"), ".v2client")

CORE_DIR = os.path.join(HOME, "core")
RUN_DIR = os.path.join(HOME, "run")
os.makedirs(CORE_DIR, exist_ok=True)
os.makedirs(RUN_DIR, exist_ok=True)

XRAY_BIN = os.path.join(CORE_DIR, "xray.exe" if IS_WIN else "xray")
CONF = os.path.join(RUN_DIR, "config.json")
PID_FILE = os.path.join(RUN_DIR, "xray.pid")
XRAY_LOG = os.path.join(RUN_DIR, "xray.log")
HOST_LOG = os.path.join(RUN_DIR, "host.log")
NO_WINDOW = 0x08000000 if IS_WIN else 0
UA = "V2Client-Host/" + HOST_VERSION

_OUT = sys.stdout.buffer
sys.stdout = sys.stderr  # stray prints must never corrupt the message stream


def hlog(msg):
    try:
        if os.path.exists(HOST_LOG) and os.path.getsize(HOST_LOG) > 300000:
            os.replace(HOST_LOG, HOST_LOG + ".1")
        with open(HOST_LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(msg) + "\n")
    except Exception:
        pass


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    data = sys.stdin.buffer.read(n)
    return json.loads(data.decode("utf-8"))


def send(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    _OUT.write(struct.pack("<I", len(data)) + data)
    _OUT.flush()


def ok(**kw):
    kw["ok"] = True
    return kw


def err(code, message):
    return {"ok": False, "code": code, "error": message}


# ------------------------------------------------------------------ core / process

def core_env():
    e = dict(os.environ)
    e["XRAY_LOCATION_ASSET"] = CORE_DIR
    return e


def run_quiet(cmd, timeout=15):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout, creationflags=NO_WINDOW, env=core_env(), cwd=CORE_DIR)


def installed_version():
    if not os.path.isfile(XRAY_BIN):
        return None
    try:
        out = run_quiet([XRAY_BIN, "version"], 10).stdout.decode("utf-8", "replace")
    except Exception as e:
        hlog("xray version failed: %s" % e)
        return None
    m = re.search(r"Xray\s+v?(\d+(?:\.\d+)+)", out)
    return m.group(1) if m else None


def read_pid():
    try:
        with open(PID_FILE) as f:
            return int(f.read().strip())
    except Exception:
        return None


def pid_alive(pid):
    if not pid:
        return False
    if IS_WIN:
        try:
            r = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
                               creationflags=NO_WINDOW)
            return b"xray" in r.stdout.lower()
        except Exception:
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        with open("/proc/%d/stat" % pid) as f:
            return f.read().rsplit(")", 1)[-1].split()[0] != "Z"
    except Exception:
        return True


def stop_xray():
    pid = read_pid()
    stopped = False
    if pid and pid_alive(pid):
        try:
            if IS_WIN:
                subprocess.run(["taskkill", "/PID", str(pid), "/F", "/T"], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=10, creationflags=NO_WINDOW)
            else:
                os.kill(pid, signal.SIGTERM)
        except Exception as e:
            hlog("stop failed: %s" % e)
        for _ in range(40):
            if not pid_alive(pid):
                stopped = True
                break
            time.sleep(0.1)
        if not stopped and not IS_WIN:
            try:
                os.kill(pid, signal.SIGKILL)
                stopped = True
            except Exception:
                pass
    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    return stopped


def port_open(port, timeout=0.3):
    try:
        s = socket.create_connection(("127.0.0.1", int(port)), timeout)
        s.close()
        return True
    except Exception:
        return False


def tail_file(path, max_bytes=6000):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            return f.read().decode("utf-8", "replace")
    except Exception:
        return ""


# ------------------------------------------------------------------ config builder

def stream_settings(s):
    net = (s.get("net") or "tcp").lower()
    sec = (s.get("security") or "none").lower()
    st = {"network": net}
    if sec == "tls":
        tls = {"serverName": s.get("sni") or s.get("host") or s["server"]}
        if s.get("alpn"):
            tls["alpn"] = [x for x in s["alpn"].split(",") if x]
        if s.get("fp"):
            tls["fingerprint"] = s["fp"]
        if s.get("allowInsecure"):
            tls["allowInsecure"] = True
        st["security"] = "tls"
        st["tlsSettings"] = tls
    elif sec == "reality":
        st["security"] = "reality"
        st["realitySettings"] = {
            "serverName": s.get("sni") or "", "fingerprint": s.get("fp") or "chrome",
            "publicKey": s.get("pbk") or "", "shortId": s.get("sid") or "",
            "spiderX": s.get("spx") or "",
        }
    host = s.get("host") or ""
    path = s.get("path") or "/"
    if net == "ws":
        st["wsSettings"] = {"path": path, "headers": {"Host": host} if host else {}}
    elif net == "grpc":
        st["grpcSettings"] = {"serviceName": s.get("serviceName") or "", "multiMode": s.get("mode") == "multi"}
    elif net in ("h2", "http"):
        st["network"] = "h2"
        st["httpSettings"] = {"path": path, "host": [h for h in host.split(",") if h]}
    elif net == "httpupgrade":
        st["httpupgradeSettings"] = {"path": path, "host": host}
    elif net in ("xhttp", "splithttp"):
        st["network"] = "xhttp"
        xs = {"path": path, "host": host}
        if s.get("mode"):
            xs["mode"] = s["mode"]
        st["xhttpSettings"] = xs
    elif net == "tcp" and s.get("headerType") == "http":
        st["tcpSettings"] = {"header": {"type": "http", "request": {
            "path": [p for p in path.split(",") if p],
            "headers": {"Host": [h for h in host.split(",") if h]}}}}
    return st


def outbound(s):
    p = s["protocol"]
    addr, port = s["server"], int(s["port"])
    if p == "vmess":
        settings = {"vnext": [{"address": addr, "port": port, "users": [{
            "id": s["uuid"], "alterId": int(s.get("aid") or 0), "security": s.get("cipher") or "auto"}]}]}
    elif p == "vless":
        user = {"id": s["uuid"], "encryption": s.get("encryption") or "none"}
        if s.get("flow"):
            user["flow"] = s["flow"]
        settings = {"vnext": [{"address": addr, "port": port, "users": [user]}]}
    elif p == "trojan":
        settings = {"servers": [{"address": addr, "port": port, "password": s["password"]}]}
    elif p == "ss":
        settings = {"servers": [{"address": addr, "port": port, "method": s["method"], "password": s["password"]}]}
    else:
        raise ValueError("Unsupported protocol: %s" % p)
    ob = {"tag": "proxy", "protocol": "shadowsocks" if p == "ss" else p, "settings": settings}
    if p != "ss":
        ob["streamSettings"] = stream_settings(s)
    return ob


def build_config(s, port, mode, direct_domains):
    direct_ip = ["geoip:private"]
    direct_dom = []
    strategy = "AsIs"
    if mode == "bypass-ir":
        direct_ip.append("geoip:ir")
        direct_dom.append("domain:ir")
        strategy = "IPIfNonMatch"
    for d in direct_domains or []:
        d = str(d).strip().lstrip("*.").lower()
        if d:
            direct_dom.append("domain:" + d)
    rules = []
    if direct_dom:
        rules.append({"type": "field", "domain": direct_dom, "outboundTag": "direct"})
    rules.append({"type": "field", "ip": direct_ip, "outboundTag": "direct"})
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [{
            "tag": "socks-in", "listen": "127.0.0.1", "port": int(port), "protocol": "socks",
            "settings": {"auth": "noauth", "udp": True, "ip": "127.0.0.1"},
            "sniffing": {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": True},
        }],
        "outbounds": [outbound(s), {"tag": "direct", "protocol": "freedom"},
                      {"tag": "block", "protocol": "blackhole"}],
        "routing": {"domainStrategy": strategy, "rules": rules},
    }


def do_start(msg):
    s = msg.get("server") or {}
    port = int(msg.get("socksPort") or 10808)
    if not os.path.isfile(XRAY_BIN):
        return err("core_missing", "The Xray core is not installed yet.")
    stop_xray()
    if port_open(port):
        return err("port_busy", "Port %d is already in use by another program. Change the port in Settings." % port)
    try:
        cfg = build_config(s, port, msg.get("mode") or "global", msg.get("directDomains") or [])
    except Exception as e:
        return err("config_build", "Could not build the config: %s" % e)
    with open(CONF, "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    t = run_quiet([XRAY_BIN, "run", "-test", "-c", CONF], 25)
    if t.returncode != 0:
        return err("config_invalid", "Xray rejected the config: " + t.stdout.decode("utf-8", "replace")[-500:].strip())
    logf = open(XRAY_LOG, "ab")
    logf.write(("\n--- start %s ---\n" % time.strftime("%Y-%m-%d %H:%M:%S")).encode())
    logf.flush()
    args = [XRAY_BIN, "run", "-c", CONF]
    kw = dict(stdin=subprocess.DEVNULL, stdout=logf, stderr=subprocess.STDOUT, cwd=CORE_DIR, env=core_env())
    if IS_WIN:
        base = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        try:
            p = subprocess.Popen(args, creationflags=base | 0x01000000, **kw)  # + BREAKAWAY_FROM_JOB
        except OSError:
            p = subprocess.Popen(args, creationflags=base, **kw)
    else:
        p = subprocess.Popen(args, start_new_session=True, **kw)
    with open(PID_FILE, "w") as f:
        f.write(str(p.pid))
    deadline = time.time() + 6
    ready = False
    while time.time() < deadline and p.poll() is None:
        if port_open(port):
            ready = True
            break
        time.sleep(0.15)
    if p.poll() is not None:
        return err("core_exited", "Xray stopped right after starting: " + tail_file(XRAY_LOG, 800).strip()[-500:])
    if not ready:
        stop_xray()
        return err("port_timeout", "Xray did not open the local port in time.")
    hlog("xray started pid=%s port=%s" % (p.pid, port))
    return ok(pid=p.pid, port=port)


# ------------------------------------------------------------------ core download / update

def vt(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def asset_name():
    m = platform.machine().lower()
    bits64 = struct.calcsize("P") == 8
    arm = m in ("arm64", "aarch64")
    if IS_WIN:
        if arm:
            return "Xray-windows-arm64-v8a.zip"
        return "Xray-windows-64.zip" if bits64 else "Xray-windows-32.zip"
    if sys.platform == "darwin":
        return "Xray-macos-arm64-v8a.zip" if arm else "Xray-macos-64.zip"
    if arm:
        return "Xray-linux-arm64-v8a.zip"
    return "Xray-linux-64.zip" if bits64 else "Xray-linux-32.zip"


def http_open(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/vnd.github+json, */*"})
    return urllib.request.urlopen(req, timeout=timeout)


def latest_release():
    with http_open("https://api.github.com/repos/XTLS/Xray-core/releases/latest", 20) as r:
        j = json.loads(r.read().decode("utf-8"))
    return j["tag_name"], {a["name"]: a["browser_download_url"] for a in j.get("assets", [])}


def download(url, dest, progress):
    with http_open(url, 60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done, last = 0, -10
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = int(done * 100 / total)
                if pct - last >= 4:
                    last = pct
                    progress("download", pct, "Downloading Xray core... %d%%" % pct)


def verify_sha256(path, url):
    try:
        with http_open(url + ".dgst", 15) as r:
            txt = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"SHA2-256\s*=\s*([0-9a-fA-F]{64})", txt)
    if not m:
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().lower() == m.group(1).lower()


def do_core_update(msg, progress):
    force = bool(msg.get("force"))
    cur = installed_version()
    tag, assets, latest = None, {}, None
    try:
        tag, assets = latest_release()
        latest = tag.lstrip("v")
    except Exception as e:
        hlog("release check failed: %s" % e)
        if cur:
            return ok(updated=False, version=cur, latest=None,
                      warn="Could not check for updates (offline or GitHub unreachable).")
    if cur and latest and not force and vt(cur) >= vt(latest):
        return ok(updated=False, version=cur, latest=latest)
    name = asset_name()
    url = assets.get(name) or ("https://github.com/XTLS/Xray-core/releases/latest/download/" + name)
    progress("download", 0, "Downloading Xray core...")
    tmp = tempfile.mkdtemp(prefix="v2c_", dir=HOME)
    try:
        zpath = os.path.join(tmp, name)
        download(url, zpath, progress)
        good = verify_sha256(zpath, url)
        if good is False:
            return err("checksum", "Downloaded file failed the SHA-256 check. Try again.")
        progress("install", 100, "Installing...")
        was_running = pid_alive(read_pid())
        stop_xray()
        wanted = {"xray", "xray.exe", "geoip.dat", "geosite.dat"}
        with zipfile.ZipFile(zpath) as z:
            for info in z.infolist():
                base = os.path.basename(info.filename)
                if base.lower() not in wanted:
                    continue
                target = os.path.join(CORE_DIR, base)
                with z.open(info) as src, open(target + ".new", "wb") as dst:
                    shutil.copyfileobj(src, dst)
                os.replace(target + ".new", target)
        if not IS_WIN:
            os.chmod(XRAY_BIN, 0o755)
    except Exception as e:
        hlog("core install failed: %s\n%s" % (e, traceback.format_exc()))
        return err("download_failed", "Could not download/install the core: %s" % e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    new = installed_version()
    if not new:
        return err("core_broken", "The core was installed but does not run. Antivirus may have blocked it.")
    return ok(updated=True, version=new, latest=latest or new, wasRunning=was_running, verified=good)


# ------------------------------------------------------------------ tests

def tcp_ping(host, port, timeout):
    t = time.time()
    try:
        s = socket.create_connection((host, int(port)), timeout)
        s.close()
    except Exception:
        return None
    return max(1, int((time.time() - t) * 1000))


def do_tcping(msg):
    targets = msg.get("targets") or []
    timeout = float(msg.get("timeout") or 3)
    with ThreadPoolExecutor(max_workers=32) as ex:
        futs = {t["id"]: ex.submit(tcp_ping, t["host"], t["port"], timeout) for t in targets}
        return ok(results={k: f.result() for k, f in futs.items()})


# ------------------------------------------------------------------ dispatcher

def handle(msg, progress):
    a = msg.get("action")
    if a == "hello":
        return ok(hostVersion=HOST_VERSION, os=platform.system(), arch=platform.machine(),
                  python=platform.python_version(), home=HOME)
    if a == "core_status":
        v = installed_version()
        return ok(installed=bool(v), version=v, running=pid_alive(read_pid()))
    if a == "core_update":
        return do_core_update(msg, progress)
    if a == "start":
        return do_start(msg)
    if a == "stop":
        return ok(stopped=stop_xray())
    if a == "status":
        pid = read_pid()
        alive = pid_alive(pid)
        port = msg.get("socksPort")
        return ok(running=alive, pid=pid, portOpen=port_open(port) if (alive and port) else False)
    if a == "tcping":
        return do_tcping(msg)
    if a == "get_log":
        return ok(core=tail_file(XRAY_LOG, 5000), host=tail_file(HOST_LOG, 3000))
    return err("unknown_action", "Unknown action: %s" % a)


def main():
    while True:
        try:
            msg = read_msg()
        except Exception as e:
            hlog("read error: %s" % e)
            break
        if msg is None:
            break

        def progress(stage, pct, text):
            send({"type": "progress", "stage": stage, "pct": pct, "msg": text})

        try:
            res = handle(msg, progress)
        except Exception as e:
            hlog("handler error: %s\n%s" % (e, traceback.format_exc()))
            res = err("host_error", str(e))
        res["type"] = "result"
        res["action"] = msg.get("action")
        send(res)


if __name__ == "__main__":
    main()

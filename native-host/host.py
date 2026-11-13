#!/usr/bin/env python3
"""Native messaging host: runs xray-core with a SOCKS5 inbound on 127.0.0.1."""
import json, os, signal, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_bundled = os.path.join(HERE, "xray.exe" if os.name == "nt" else "xray")
XRAY = os.environ.get("XRAY_PATH") or (_bundled if os.path.exists(_bundled) else "xray")
TMP = tempfile.gettempdir()
CONF = os.path.join(TMP, "v2chrome_xray.json")
PID_FILE = os.path.join(TMP, "v2chrome_xray.pid")

def read_msg():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))

def send(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()

def stream_settings(s):
    net = s.get("net", "tcp")
    st = {"network": net}
    if s.get("security") == "reality":
        st["security"] = "reality"
        st["realitySettings"] = {
            "serverName": s.get("sni", ""), "publicKey": s.get("pbk", ""),
            "shortId": s.get("sid", ""), "fingerprint": s.get("fp") or "chrome",
        }
    elif s.get("security") in ("tls",):
        st["security"] = "tls"
        st["tlsSettings"] = {"serverName": s.get("sni") or s["server"]}
    if net == "ws":
        st["wsSettings"] = {"path": s.get("path", "/"), "headers": {"Host": s.get("host", "")}}
    elif net == "grpc":
        st["grpcSettings"] = {"serviceName": s.get("path", "")}
    return st

def outbound(s):
    proto = s["protocol"]
    if proto == "vmess":
        settings = {"vnext": [{"address": s["server"], "port": s["port"],
            "users": [{"id": s["id_"], "alterId": s.get("aid", 0), "security": "auto"}]}]}
    elif proto == "vless":
        user = {"id": s["uuid"], "encryption": "none"}
        if s.get("flow"):
            user["flow"] = s["flow"]
        settings = {"vnext": [{"address": s["server"], "port": s["port"], "users": [user]}]}
    elif proto == "trojan":
        settings = {"servers": [{"address": s["server"], "port": s["port"], "password": s["password"]}]}
    else:
        raise ValueError(f"پروتکل پشتیبانی نمی‌شود: {proto}")
    return {"tag": "proxy", "protocol": proto, "settings": settings,
            "streamSettings": stream_settings(s)}

def build_config(s, port):
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [{"listen": "127.0.0.1", "port": port, "protocol": "socks",
                      "settings": {"udp": True}}],
        "outbounds": [outbound(s), {"tag": "direct", "protocol": "freedom"}],
        "routing": {"rules": [{"type": "field", "ip": ["geoip:private"], "outboundTag": "direct"}]},
    }

def stop():
    if os.path.exists(PID_FILE):
        try:
            os.kill(int(open(PID_FILE).read().strip()), signal.SIGTERM)
        except Exception:
            pass
        os.remove(PID_FILE)

def start(server, port):
    stop()
    with open(CONF, "w") as f:
        json.dump(build_config(server, port), f)
    p = subprocess.Popen([XRAY, "run", "-c", CONF],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    with open(PID_FILE, "w") as f:
        f.write(str(p.pid))

if __name__ == "__main__":
    msg = read_msg()
    try:
        if msg is None:
            send({"ok": False, "error": "no message"})
        elif msg.get("action") == "start":
            start(msg["server"], int(msg.get("socksPort", 10808)))
            send({"ok": True})
        elif msg.get("action") == "stop":
            stop()
            send({"ok": True})
        else:
            send({"ok": False, "error": "unknown action"})
    except Exception as e:
        send({"ok": False, "error": str(e)})

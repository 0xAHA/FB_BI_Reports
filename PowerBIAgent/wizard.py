"""
Configuration wizard for the Fishbowl → Power BI Agent.

Launched by the installer after copying files, and available any time
afterwards via Start Menu → Configure Agent (or FishbowlPBIAgent.exe wizard).

Writes non-sensitive values to config.ini in the install directory.
Encrypts the Fishbowl password with machine-scope DPAPI via credentials.py
so the Windows Service (running as SYSTEM) can decrypt it.
"""

import configparser
import os
import sys
import tkinter as tk
from tkinter import messagebox

# Resolve install dir — works both frozen (PyInstaller) and in dev
BASE_DIR    = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.ini")


def _load_existing() -> dict:
    # interpolation=None: the Power BI push URL contains '%' characters
    # (URL-encoded key) that would otherwise break configparser interpolation.
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read(CONFIG_PATH)
    return {
        "base_url": cfg.get("fishbowl", "base_url",  fallback="http://localhost:2456"),
        "app_name": cfg.get("fishbowl", "app_name",  fallback="PowerBI Agent"),
        "app_id":   cfg.get("fishbowl", "app_id",    fallback="200"),
        "username": cfg.get("fishbowl", "username",  fallback=""),
        "push_url": cfg.get("powerbi",  "push_url",  fallback=""),
        "interval": cfg.get("agent",    "sync_interval_minutes", fallback="15"),
        "enc_pass": cfg.get("secrets",  "password_enc", fallback=""),
    }


def _save(values: dict) -> None:
    import credentials
    cfg = configparser.ConfigParser(interpolation=None)
    cfg["fishbowl"] = {
        "base_url": values["base_url"],
        "app_name": values["app_name"],
        "app_id":   values["app_id"],
        "username": values["username"],
    }
    cfg["powerbi"] = {
        "push_url": values["push_url"],
    }
    cfg["agent"] = {
        "sync_interval_minutes": values["interval"],
        "log_file": os.path.join(BASE_DIR, "agent.log"),
    }
    cfg["secrets"] = {
        "password_enc": credentials.encrypt(values["password"]),
    }
    with open(CONFIG_PATH, "w") as f:
        cfg.write(f)


class Wizard(tk.Tk):
    PAD = {"padx": 12, "pady": 5}

    def __init__(self):
        super().__init__()
        self.title("Fishbowl → Power BI Agent — Configuration")
        self.resizable(False, False)
        self.saved = False

        ex = _load_existing()

        # ── Header ────────────────────────────────────────────────
        hdr = tk.Frame(self, bg="#1e293b")
        hdr.grid(row=0, column=0, columnspan=2, sticky="ew")
        tk.Label(hdr, text="Fishbowl → Power BI Agent",
                 bg="#1e293b", fg="white",
                 font=("Segoe UI", 13, "bold"), pady=10).pack()
        tk.Label(hdr, text="Fill in the settings below then click Save.",
                 bg="#1e293b", fg="#94a3b8",
                 font=("Segoe UI", 9)).pack(pady=(0, 8))

        self.columnconfigure(1, weight=1)
        r = 1

        # ── Fishbowl Server ───────────────────────────────────────
        r = self._section(r, "Fishbowl Server")
        self.base_url = self._row(r, "Server URL",   ex["base_url"], "http://your-server:2456"); r += 1
        self.app_name = self._row(r, "App Name",     ex["app_name"]); r += 1
        self.app_id   = self._row(r, "App ID",       ex["app_id"]); r += 1
        tk.Label(self,
                 text="App must be approved in Fishbowl → Setup → Settings → Integrated Apps",
                 fg="#64748b", font=("Segoe UI", 8)
                 ).grid(row=r, column=1, sticky="w", padx=(0, 12), pady=(0, 6)); r += 1

        # ── Credentials ───────────────────────────────────────────
        r = self._section(r, "Fishbowl Credentials")
        self.username = self._row(r, "Username", ex["username"]); r += 1
        self.password = self._row(r, "Password", "", show="*"); r += 1
        hint = "(leave blank to keep existing password)" if ex["enc_pass"] else ""
        if hint:
            tk.Label(self, text=hint, fg="#94a3b8",
                     font=("Segoe UI", 8)).grid(row=r, column=1, sticky="w",
                                                padx=(0, 12)); r += 1

        # ── Power BI ──────────────────────────────────────────────
        r = self._section(r, "Power BI")
        self.push_url = self._row(r, "Streaming Dataset URL", ex["push_url"],
                                  "https://api.powerbi.com/beta/…"); r += 1
        tk.Label(self,
                 text="Get this from app.powerbi.com → + New → Streaming dataset → API",
                 fg="#64748b", font=("Segoe UI", 8)
                 ).grid(row=r, column=1, sticky="w", padx=(0, 12), pady=(0, 6)); r += 1

        # ── Schedule ──────────────────────────────────────────────
        r = self._section(r, "Schedule")
        self.interval = self._row(r, "Sync interval (minutes)", ex["interval"]); r += 1

        # ── Buttons ───────────────────────────────────────────────
        btn_frame = tk.Frame(self)
        btn_frame.grid(row=r, column=0, columnspan=2, sticky="e", padx=12, pady=14)
        tk.Button(btn_frame, text="Cancel", width=10,
                  command=self.destroy).pack(side="right", padx=(6, 0))
        tk.Button(btn_frame, text="Save & Close", width=14,
                  bg="#1e293b", fg="white", relief="flat", cursor="hand2",
                  font=("Segoe UI", 9, "bold"),
                  command=self._on_save).pack(side="right")

        self.update_idletasks()
        x = (self.winfo_screenwidth()  - self.winfo_width())  // 2
        y = (self.winfo_screenheight() - self.winfo_height()) // 2
        self.geometry(f"+{x}+{y}")

    def _section(self, row: int, label: str) -> int:
        tk.Label(self, text=label, font=("Segoe UI", 9, "bold"),
                 fg="#0f172a", bg="#f1f5f9"
                 ).grid(row=row, column=0, columnspan=2, sticky="ew",
                        padx=12, pady=(10, 3))
        return row + 1

    def _row(self, row: int, label: str, value: str = "",
             placeholder: str = "", show: str = "") -> tk.StringVar:
        tk.Label(self, text=label, font=("Segoe UI", 9),
                 anchor="w").grid(row=row, column=0, sticky="w",
                                  padx=(12, 4), pady=3)
        var = tk.StringVar(value=value)
        e = tk.Entry(self, textvariable=var, width=55, show=show,
                     font=("Segoe UI", 9))
        e.grid(row=row, column=1, sticky="ew", padx=(0, 12), pady=3)
        return var

    def _on_save(self) -> None:
        ex = _load_existing()
        password = self.password.get()

        if not password:
            if not ex["enc_pass"]:
                messagebox.showerror("Required", "Password is required on first setup.")
                return
            # Keep existing encrypted password — re-decrypt to pass through save
            import credentials
            password = credentials.decrypt(ex["enc_pass"])

        errors = []
        if not self.base_url.get().strip(): errors.append("Server URL")
        if not self.username.get().strip(): errors.append("Username")
        if not self.push_url.get().strip(): errors.append("Streaming Dataset URL")
        try:
            if int(self.interval.get().strip()) < 1:
                errors.append("Sync interval (must be 1 or more minutes)")
        except ValueError:
            errors.append("Sync interval (must be a number)")

        if errors:
            messagebox.showerror("Missing / invalid fields", "\n".join(f"• {e}" for e in errors))
            return

        try:
            _save({
                "base_url": self.base_url.get().strip().rstrip("/"),
                "app_name": self.app_name.get().strip(),
                "app_id":   self.app_id.get().strip(),
                "username": self.username.get().strip(),
                "password": password,
                "push_url": self.push_url.get().strip(),
                "interval": self.interval.get().strip(),
            })
            self.saved = True
            messagebox.showinfo("Saved", "Configuration saved.\n\nIf the service is running, restart it to apply changes.")
            self.destroy()
        except Exception as exc:
            messagebox.showerror("Error", f"Could not save configuration:\n{exc}")


def run() -> bool:
    app = Wizard()
    app.mainloop()
    return app.saved


if __name__ == "__main__":
    run()

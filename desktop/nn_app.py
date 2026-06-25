"""
NN+ Вызов — нативная обёртка над сайтом assistant-caller.
Просто открывает наш сайт в отдельном окне и:
  • сидит в системном трее;
  • крестик НЕ закрывает приложение, а сворачивает в трей (защита от случайного закрытия);
  • при входящем вызове/сообщении (сайт ставит спец-символ в заголовок) — поднимает окно ПОВЕРХ ВСЕХ окон;
  • перезагружает страницу, если рендер упал;
  • разрешает звук без жеста (чтобы звонок звучал сразу).
Логика вызовов/звука/уведомлений — внутри сайта, здесь не дублируется.
"""
import os
import sys

# Анти-мерцание обеспечивает CSS-инъекция ниже (install_antiflicker — убирает
# backdrop-filter и непрерывные фоновые анимации, это и есть источник тиринга).
# GPU-композитинг НЕ отключаем: software-композитинг даёт сильные лаги прокрутки и
# ввода. Оставляем аппаратное ускорение Qt по умолчанию → плавно и без мерцания.

try:
    import winreg
except ImportError:
    winreg = None
from PyQt6.QtCore import Qt, QUrl, QTimer
from PyQt6.QtGui import QIcon, QAction, QPixmap, QPainter, QColor, QFont
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QSystemTrayIcon, QMenu,
    QDialog, QCheckBox, QVBoxLayout, QLabel, QDialogButtonBox,
)
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import (
    QWebEngineProfile, QWebEnginePage, QWebEngineSettings, QWebEngineScript,
)


def resource_path(name: str) -> str:
    """Путь к ресурсу — работает и в исходнике, и в собранном PyInstaller (onedir)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)

URL = os.environ.get("NN_URL", "https://your-server.example.com")
APP_NAME = "NN+ Вызов"
ALERT_PREFIXES = ("🔴", "📢", "📨")


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "NNVyzov"


def autostart_enabled() -> bool:
    if not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, RUN_NAME)
            return True
    except OSError:
        return False


def set_autostart(on: bool):
    if not winreg:
        return
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if on:
                winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, f'"{sys.executable}"')
            else:
                try:
                    winreg.DeleteValue(k, RUN_NAME)
                except OSError:
                    pass
    except OSError:
        pass


CFG_KEY = r"Software\NNVyzov"


def is_configured() -> bool:
    if not winreg:
        return True
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, CFG_KEY) as k:
            winreg.QueryValueEx(k, "configured")
            return True
    except OSError:
        return False


def mark_configured():
    if not winreg:
        return
    try:
        k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, CFG_KEY)
        winreg.SetValueEx(k, "configured", 0, winreg.REG_DWORD, 1)
        winreg.CloseKey(k)
    except OSError:
        pass


SHORTCUT_NAME = "NN+ Вызов.lnk"
OLD_SHORTCUT_NAMES = ("NN Vyzov.lnk", "NN_Vyzov.lnk", "NN+ Ассистент-Вызов.lnk")


def make_desktop_shortcut() -> bool:
    # Через PowerShell + WScript.Shell — без зависимости от pywin32.
    # -EncodedCommand (UTF-16LE base64) — чтобы кириллица в имени не ломалась.
    try:
        import subprocess
        import base64
        target = sys.executable.replace("'", "''")
        workdir = os.path.dirname(sys.executable).replace("'", "''")
        rm_old = "".join(
            f"$o=Join-Path $d '{n}'; if(Test-Path $o){{Remove-Item $o -Force}};"
            for n in OLD_SHORTCUT_NAMES
        )
        ps = (
            "$ws=New-Object -ComObject WScript.Shell;"
            "$d=$ws.SpecialFolders('Desktop');"
            + rm_old +
            f"$s=$ws.CreateShortcut((Join-Path $d '{SHORTCUT_NAME}'));"
            f"$s.TargetPath='{target}';"
            f"$s.WorkingDirectory='{workdir}';"
            f"$s.IconLocation='{target},0';"
            "$s.Description='NN+ Вызов — вызов ассистента';"
            "$s.Save()"
        )
        enc = base64.b64encode(ps.encode("utf-16-le")).decode("ascii")
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc],
            creationflags=0x08000000, timeout=15,
        )
        return r.returncode == 0
    except Exception:
        return False


class SetupDialog(QDialog):
    """Окно при первом запуске: ярлык на рабочем столе + автозапуск."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Настройка NN+ Вызов")
        self.setWindowIcon(make_icon())
        self.setModal(True)
        lay = QVBoxLayout(self)
        lay.addWidget(QLabel("Как удобнее запускать приложение?"))
        self.cb_desktop = QCheckBox("Создать ярлык на рабочем столе")
        self.cb_desktop.setChecked(True)
        self.cb_auto = QCheckBox("Запускать автоматически при входе в Windows")
        self.cb_auto.setChecked(True)
        lay.addWidget(self.cb_desktop)
        lay.addWidget(self.cb_auto)
        box = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        box.button(QDialogButtonBox.StandardButton.Ok).setText("Готово")
        box.button(QDialogButtonBox.StandardButton.Cancel).setText("Пропустить")
        box.accepted.connect(self.accept)
        box.rejected.connect(self.reject)
        lay.addWidget(box)
        self.resize(400, 190)


_icon_cache: "QIcon | None" = None


def make_icon() -> QIcon:
    global _icon_cache
    if _icon_cache is not None:
        return _icon_cache
    ico = resource_path("app.ico")
    if os.path.exists(ico):
        ic = QIcon(ico)
        if not ic.isNull():
            _icon_cache = ic
            return ic
    # Фолбэк: рисуем NN, если .ico по какой-то причине не нашлась.
    pm = QPixmap(64, 64)
    pm.fill(QColor(3, 28, 23))
    p = QPainter(pm)
    p.setPen(QColor(52, 211, 153))
    p.setFont(QFont("Arial", 22, QFont.Weight.Black))
    p.drawText(pm.rect(), Qt.AlignmentFlag.AlignCenter, "NN+")
    p.end()
    _icon_cache = QIcon(pm)
    return _icon_cache


# CSS, который убирает мерцание именно в десктоп-обёртке (на телефоне сайт не трогаем):
# отключаем backdrop-filter (блюр пересэмпливается каждый кадр поверх анимаций) и
# гасим непрерывные фоновые анимации (орбы/сетка/глифы/ЭКГ/пульс).
_ANTIFLICKER_JS = r"""
(function(){
  if (document.getElementById('nnvyzov-af')) return;
  var s = document.createElement('style'); s.id = 'nnvyzov-af';
  s.textContent =
    '*{-webkit-backdrop-filter:none !important;backdrop-filter:none !important}' +
    '.bg-orbs::before,.bg-orbs::after,.bg-glyphs,.bg-ecg{display:none !important}' +
    '.nn-pulse{animation:none !important}' +
    '.bg-orbs{background:#04201a !important}';
  (document.head || document.documentElement).appendChild(s);
})();
"""


def install_antiflicker(profile: QWebEngineProfile):
    sc = QWebEngineScript()
    sc.setName("nnvyzov-antiflicker")
    sc.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
    sc.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
    sc.setRunsOnSubFrames(False)
    sc.setSourceCode(_ANTIFLICKER_JS)
    profile.scripts().insert(sc)


class CallPage(QWebEnginePage):
    """Авто-выдача разрешений (уведомления/микрофон) без диалогов."""
    def __init__(self, profile, parent=None):
        super().__init__(profile, parent)
        self.featurePermissionRequested.connect(self._grant)

    def _grant(self, origin, feature):
        try:
            self.setFeaturePermission(origin, feature, QWebEnginePage.PermissionPolicy.PermissionGrantedByUser)
        except Exception:
            pass


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(APP_NAME)
        self.setWindowIcon(make_icon())
        self.resize(1120, 780)
        self._really_quit = False

        profile = QWebEngineProfile("nnvyzov", self)
        profile.setHttpUserAgent(profile.httpUserAgent() + " NNVyzovApp/1.0")
        install_antiflicker(profile)
        self.view = QWebEngineView(self)
        self.view.setPage(CallPage(profile, self.view))
        s = self.view.settings()
        s.setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
        s.setAttribute(QWebEngineSettings.WebAttribute.ScreenCaptureEnabled, True)
        self.view.load(QUrl(URL))
        self.setCentralWidget(self.view)

        self.view.page().renderProcessTerminated.connect(
            lambda *a: QTimer.singleShot(1500, self.view.reload)
        )
        self.view.titleChanged.connect(self.on_title)

        self.tray = QSystemTrayIcon(make_icon(), self)
        self.tray.setToolTip(APP_NAME)
        menu = QMenu()
        for text, slot in (
            ("Открыть", self.show_front),
            ("Обновить", self.view.reload),
        ):
            act = QAction(text, self); act.triggered.connect(slot); menu.addAction(act)
        a_sc = QAction("Создать ярлык на рабочем столе", self)
        a_sc.triggered.connect(self._make_shortcut)
        menu.addAction(a_sc)
        self.a_auto = QAction("Запускать при входе в Windows", self, checkable=True)
        self.a_auto.setChecked(autostart_enabled())
        self.a_auto.toggled.connect(self._toggle_autostart)
        menu.addAction(self.a_auto)
        menu.addSeparator()
        q = QAction("Выход", self); q.triggered.connect(self.real_quit); menu.addAction(q)
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(self._tray_activated)
        self.tray.show()

        # Окно настройки при первом запуске (ярлык + автозапуск)
        if not is_configured():
            QTimer.singleShot(900, self._first_run_setup)

    def _first_run_setup(self):
        dlg = SetupDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            if dlg.cb_desktop.isChecked():
                make_desktop_shortcut()
            if dlg.cb_auto.isChecked():
                set_autostart(True)
                self.a_auto.setChecked(True)
        mark_configured()

    def _make_shortcut(self):
        ok = make_desktop_shortcut()
        self.tray.showMessage(
            APP_NAME,
            "Ярлык создан на рабочем столе" if ok else "Не удалось создать ярлык",
            QSystemTrayIcon.MessageIcon.Information, 3000,
        )

    def _toggle_autostart(self, on: bool):
        set_autostart(on)
        self.tray.showMessage(
            APP_NAME,
            "Автозапуск при входе включён" if on else "Автозапуск выключен",
            QSystemTrayIcon.MessageIcon.Information, 3000,
        )

    def _tray_activated(self, reason):
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            self.show_front()

    def show_front(self):
        self.showNormal(); self.raise_(); self.activateWindow()

    def on_title(self, title: str):
        if title and title[:1] in ALERT_PREFIXES:
            self._flash_on_top()

    def _flash_on_top(self):
        self.setWindowState((self.windowState() & ~Qt.WindowState.WindowMinimized) | Qt.WindowState.WindowActive)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.show(); self.raise_(); self.activateWindow()
        QTimer.singleShot(6000, self._drop_on_top)

    def _drop_on_top(self):
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, False)
        self.show()

    def closeEvent(self, e):
        if self._really_quit:
            e.accept(); return
        e.ignore()
        self.hide()
        self.tray.showMessage(
            APP_NAME,
            "Свёрнуто в трей — продолжаю принимать вызовы. Полный выход — через меню в трее.",
            QSystemTrayIcon.MessageIcon.Information, 4000,
        )

    def real_quit(self):
        self._really_quit = True
        self.tray.hide()
        QApplication.quit()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setQuitOnLastWindowClosed(False)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

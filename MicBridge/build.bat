@echo off
title MPVC — Build EXE

echo Installing dependencies...
pip install -r requirements.txt pyinstaller -q

echo.
echo Converting icon...
python -c "from PIL import Image; Image.open('icon.png').save('icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(256,256)])"

echo.
echo Building MPVC.exe...
pyinstaller ^
    --onefile ^
    --noconsole ^
    --name MPVC ^
    --icon icon.ico ^
    --hidden-import pystray._win32 ^
    --collect-data sounddevice ^
    --add-data "icon.png;." ^
    mic_bridge.py

echo.
if exist dist\MPVC.exe (
    echo  Build successful^^!  dist\MPVC.exe
) else (
    echo  Build FAILED. Check output above.
)
pause
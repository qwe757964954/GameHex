rem F:\pmshare\piaomiao\TreeKingdoms\client\client_proto\fairGUI\copy_fgui.bat
REM des: F:\pmshare\piaomiao\TreeKingdoms\client\assets\resources
REM src: F:\pmshare\piaomiao\TreeKingdoms\zarts\art\UIProject\trunk\Publish\assets\resources
pushd %~dp0
set root=..\..\..\
set src=%root%zarts\art\UIProject\trunk\Publish\assets\resources
set des=%root%client\assets\resources
python copy_newer.py %src% %des%
pause
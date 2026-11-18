# Arranges all Windows Terminal windows in a grid of eight cells, each 1/8 of the work area: the first four fill
# the left half (2 x 2), further ones the right half. Sorted by window title. Terminal refuses to get narrower than
# about 460 px, so one column per window (320 px on 2560 px) would overlap.
# Moves windows only: no focus change, no input.
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class TerminalFenster{
 public delegate bool P(IntPtr h,IntPtr l);
 public struct R{public int L,T,Ri,B;}
 [DllImport("user32")] static extern bool EnumWindows(P p,IntPtr l);
 [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32")] public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32")] public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int b,int c,uint f);
 [DllImport("dwmapi")] public static extern int DwmGetWindowAttribute(IntPtr h,int a,out R r,int n);
 public static string Titel(IntPtr h){var s=new StringBuilder(256);GetWindowText(h,s,256);return s.ToString();}
 public static List<IntPtr> Alle(){var a=new List<IntPtr>();EnumWindows((h,l)=>{var s=new StringBuilder(64);GetClassName(h,s,64);if(s.ToString()=="CASCADIA_HOSTING_WINDOW_CLASS"&&IsWindowVisible(h))a.Add(h);return true;},IntPtr.Zero);return a;}
}
"@
Add-Type -AssemblyName System.Windows.Forms
$flaeche = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$breite = [int][Math]::Floor($flaeche.Width / 4)
$hoehe = [int][Math]::Floor($flaeche.Height / 2)
$SWP = 0x0014   # SWP_NOZORDER | SWP_NOACTIVATE
$i = 0
# A script started from a tool opens a short-lived window titled with the path of its shell; it does not count
$fenster = [TerminalFenster]::Alle() | Where-Object { [TerminalFenster]::Titel($_) -notmatch '\\(pwsh|powershell|cmd)\.exe$' }
foreach ($h in ($fenster | Sort-Object { [TerminalFenster]::Titel($_) })) {
    if ($i -ge 8) { "Kein Platz mehr: $([TerminalFenster]::Titel($h))"; continue }
    if ([TerminalFenster]::IsZoomed($h) -or [TerminalFenster]::IsIconic($h)) { [void][TerminalFenster]::ShowWindow($h, 4) }
    # The window rectangle includes an invisible frame; correct for it so the visible edges meet
    $a = New-Object TerminalFenster+R; $s = New-Object TerminalFenster+R
    [void][TerminalFenster]::GetWindowRect($h, [ref]$a)
    [void][TerminalFenster]::DwmGetWindowAttribute($h, 9, [ref]$s, 16)
    $li = $s.L - $a.L; $re = $a.Ri - $s.Ri; $ob = $s.T - $a.T; $un = $a.B - $s.B
    $spalte = ($i % 2) + 2 * [int][Math]::Floor($i / 4)
    $zeile = [int][Math]::Floor(($i % 4) / 2)
    [void][TerminalFenster]::SetWindowPos($h, [IntPtr]::Zero, $flaeche.X + $spalte * $breite - $li,
        $flaeche.Y + $zeile * $hoehe - $ob, $breite + $li + $re, $hoehe + $ob + $un, $SWP)
    [void][TerminalFenster]::DwmGetWindowAttribute($h, 9, [ref]$s, 16)
    "{0}: x={1} y={2} breite={3} hoehe={4} | {5}" -f ($i + 1), $s.L, $s.T, ($s.Ri - $s.L), ($s.B - $s.T), [TerminalFenster]::Titel($h)
    $i++
}

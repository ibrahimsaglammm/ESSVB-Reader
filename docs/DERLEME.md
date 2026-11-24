# ESSVB-Reader Derleme ve Paketleme Kılavuzu (`DERLEME.md`)

**Sürüm:** `0.1.0` (Hazırlık Aşaması)

> **Ortam ve CI Doğrulama Beyanı:**  
> - **Windows 11 (x64):** Bu çalışma ortamında (Windows 11) **gerçek olarak derlenmiş, test edilmiş ve paketlenmiştir** (`.exe` NSIS kurulumu, `.msi` kurulumu ve taşınabilir `.zip` arşivi üretilmiştir).  
> - **CachyOS / Arch Linux (x64):** Bu yerel makine Windows 11 olduğu için Linux paketleri yerel olarak değil **GitHub Actions (`.github/workflows/release.yml`)** üzerinde `ubuntu-22.04` (AppImage) ve `archlinux:base-devel` konteyneri (`makepkg` ile `.pkg.tar.zst`) kullanılarak derlenip GitHub Releases sayfasında yayınlanmaktadır (`https://github.com/ibrahimsaglammm/ESSVB-Reader/releases`).

---

## 1. Windows 11 (x64) Derleme ve Paketleme

### Gereksinimler
- Node.js `>= 22` ve `pnpm` (`12.x`)
- Rust araç zinciri (`rustc`, `cargo`, `clippy`, `rustfmt`) — MSVC (`x86_64-pc-windows-msvc`)
- Visual Studio 2022/2026 C++ Build Tools & Windows SDK
- Microsoft Edge WebView2 Runtime (Windows 11'de yerleşiktir)

### Tüm Kontrolleri Çalıştırma
```powershell
cd ESSVB-Reader
.\scripts\check-all.ps1
```

### Kurulum Paketleri (.msi / .exe) ve Taşınabilir (.zip) Sürüm Üretme
```powershell
cd ESSVB-Reader
.\scripts\build-windows.ps1
```
Üretilen dosyalar `ESSVB-Reader/dist-packages/` klasöründe toplanır:
- `ESSVB-Reader_0.1.0_x64_en-US.msi` (veya yerel MSI çıktısı)
- `ESSVB-Reader_0.1.0_x64-setup.exe` (NSIS kurulumu)
- `ESSVB-Reader-0.1.0-windows-x64-portable.zip` (yanında `portable.txt` ile çalışır; veriler `<exe_dir>\data\` altına kaydedilir)

### Türkçe Sesli Okuma (Microsoft Tolga)
Windows 11'de **Ayarlar > Zaman ve Dil > Konuşma > Ses ekle** bölümünden Türkçe ses paketi (`Microsoft Tolga`) kurulu olduğunda ESSVB-Reader bunu WinRT `Windows.Media.SpeechSynthesis` ile otomatik algılar.

---

## 2. CachyOS / Arch Linux (x64) Derleme ve Paketleme

*(Not: Aşağıdaki adımlar Windows geliştirme ortamında çalıştırılmamıştır; CachyOS / Arch Linux makinede yürütülmelidir.)*

### Gereksinimler
```bash
sudo pacman -S --needed base-devel rustup nodejs pnpm webkit2gtk-4.1 gtk3 libsecret pkgconf patchelf squashfuse
rustup default stable
```

İsteğe bağlı çevrimdışı Türkçe TTS motorları:
```bash
sudo pacman -S espeak-ng
# Daha doğal nöral Türkçe ses için (AUR):
paru -S piper-tts-bin
# Türkçe .onnx modelini ~/.local/share/essvb-reader/voices/ altına koyun veya Ayarlar'dan yolunu seçin.
```

### AppImage Üretimi
```bash
cd ESSVB-Reader
chmod +x scripts/build-linux.sh
./scripts/build-linux.sh
```
Çıktı `ESSVB-Reader/dist-packages/*.AppImage` olarak oluşur.

### Arch / CachyOS Paketi (`PKGBUILD`) Derleme ve Kurma
```bash
cd ESSVB-Reader/packaging/arch
makepkg -si
```
`essvb-reader` ikilisi `/usr/bin/essvb-reader`, masaüstü girdisi `/usr/share/applications/essvb-reader.desktop` ve lisanslar `/usr/share/licenses/essvb-reader/` altına kurulur.

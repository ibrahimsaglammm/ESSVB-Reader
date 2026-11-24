# ESSVB-Reader `v0.1.0`

**Türkçe** | [English](#english)

> **Durum:** `0.1.0` (Hazırlık Aşaması / Ön Sürüm) — Sıfırdan geliştirilmiş, telemetrisiz, gizlilik odaklı masaüstü EPUB okuyucu.

## Gizlilik Taahhüdü
- **Sıfır Telemetri:** Analitik, çökme raporu, kullanım istatistiği, cihaz parmak izi veya dış font/script CDN isteği **yoktur**.
- **GitHub Güncelleme Kontrolü (Kullanıcı Onaylı):** Uygulama açılışta ve ayarlanabilir aralıklarla yalnızca resmi GitHub Releases deposunu (`https://github.com/ibrahimsaglammm/ESSVB-Reader/releases`) kontrol eder (Ayarlar'dan kapatılabilir). Yeni sürüm bulunduğunda size sorar; onayınız olmadan paket indirmez veya kurmaz; indirmelerde `SHA-256` doğrulaması uygular.
- **Üç Katmanlı EPUB Sandbox:** `<script>` ve olay işleyicileri Rust `ammonia` HTML5 ayrıştırıcısı ile temizlenir; harici `http(s)://` kaynaklar engellenir; bölümler `allow-scripts` olmadan `<iframe sandbox="allow-same-origin">` ve katı CSP altında açılır.
- **ZIP Güvenliği:** Tüm EPUB arşivleri zip-slip yol doğrulaması ve zip-bomb akış boyut/oran (`100:1`) korumalarıyla yalnızca bellekte açılır.
- **Güvenli Anahtar Saklama:** İsteğe bağlı Gemini API anahtarı düz metin veritabanına veya yedeklere değil, yalnızca işletim sistemi anahtar deposuna (Windows Credential Manager / Linux `libsecret`) kaydedilir.

## Özellikler
- **EPUB 2 & EPUB 3 Okuma:** İçindekiler tablosu (NCX / Nav), ilerleme ve son konum hatırlama, Türkçe duyarlı kitap içi arama, yazı tipi (yerel serif/sans/mono), boyut, satır aralığı, kenar boşluğu ve hizalama ayarları, sürükle-bırak ve toplu klasör içe aktarma.
- **Liste/Tablo Odaklı Raf Sistemi:** Çoklu raf oluşturma/yeniden adlandırma/silme, bir kitabı birden fazla rafa ekleme, sürükle-bırak ile rafa taşıma, etiket/tür/yazar/seri/okuma durumu (`Okunacak`, `Okunuyor`, `Bitti`) filtreleme ve sıralama, çoklu seçimle toplu etiketleme, metadata düzenleme, isteğe bağlı küçük kapak önizleme.
- **Temalar:** Gündüz, Gece, Sepya, Yüksek Kontrast, Özel renk seçici ve Sistem Temasını Takip Et.
- **Notlar ve Vurgular:** Metin seçimiyle 5 renkli vurgulama ve not ekleme, kitaba göre ve global arama/düzenleme/silme, Markdown ve JSON dışa aktarma, tam JSON kütüphane yedekleme (gizli anahtarlar hariç).
- **Türkçe Sesli Okuma (`TTSProvider` soyutlaması):**
  1. **Yerel Çevrimdışı (Varsayılan):** Windows 11'de WinRT OneCore **Microsoft Tolga** (`tr-TR`); CachyOS/Arch Linux'ta **Piper** (Türkçe `.onnx`) veya **eSpeak-NG** (`-v tr`).
  2. **Yerel Ollama:** Yalnızca `localhost` / `127.0.0.1` üzerinden kullanıcı seçimi modelle Türkçe telaffuz hazırlığı + yerel TTS.
  3. **Gemini TTS (İsteğe Bağlı, Varsayılan Kapalı):** Açık onay, OS anahtar deposundan anahtar ve gönderim öncesi kullanıcı onayı gerektirir. Hata durumunda başka sağlayıcıya otomatik geçmez.
- **Arayüz:** Varsayılan Türkçe, İngilizce seçenek (`i18n`), tam klavye kısayolları ve erişilebilirlik desteği, Hakkında ekranında sürüm (`0.1.0`) ve güncelleme seçenekleri.

## Klavye Kısayolları
- `Ctrl + O`: EPUB ekle
- `Sol / Sağ Ok`: Önceki / Sonraki bölüm (Okuyucu modunda)
- `Ctrl + +` / `Ctrl + -`: Yazı boyutunu büyüt / küçült
- `Boşluk (Space)`: TTS Duraklat / Devam Et
- `Escape`: Açık pencereyi kapat
- `?`: Kısayollar penceresi

## İndirme ve Kurulum / Download & Installation
Hazır derlenmiş **Windows 11 (`.msi`, `-setup.exe`, taşınabilir `.zip`)** ve **CachyOS / Arch Linux (`.AppImage`, `.pkg.tar.zst`, `PKGBUILD`)** paketleri GitHub Releases sayfasında yayımlanır:
- https://github.com/ibrahimsaglammm/ESSVB-Reader/releases

Ayrıntılı derleme adımları için [docs/DERLEME.md](docs/DERLEME.md), güvenlik raporu için [docs/GUVENLIK.md](docs/GUVENLIK.md), analiz raporu için [docs/ANALIZ.md](docs/ANALIZ.md) ve mimari kararlar için [docs/KARARLAR.md](docs/KARARLAR.md) dosyalarına bakın.

---

<a id="english"></a>

## English Overview

**ESSVB-Reader v0.1.0 (Pre-release)** is a clean-room, MIT-licensed, zero-telemetry cross-platform desktop EPUB reader built with **Tauri v2 (Rust)** and **React 19 + TypeScript**.

- **Zero Telemetry & Offline-First:** Makes zero unsolicited outbound network calls on startup or during reading. No analytics, crash reporters, or external font/script CDNs.
- **Triple-Layer EPUB Sandbox:** Rust `ammonia` HTML5 & CSS sanitizer strips all scripts, event handlers, and external URLs; chapters render inside `<iframe sandbox="allow-same-origin">` (no `allow-scripts`) with strict CSP; ZIP reader enforces zip-slip and streaming zip-bomb caps.
- **List-First Library & Shelves:** Multi-shelf membership, drag-and-drop shelf assignment, tags, genre/author/series/status filtering, bulk actions, metadata editing, and SQLite local persistence with secret-free JSON backup.
- **Turkish Speech (`TTSProvider`):**
  - **Offline Local (Default):** Windows 11 WinRT OneCore `Microsoft Tolga`; Linux `piper` (`.onnx`) or `espeak-ng -v tr`.
  - **Local Ollama:** Strictly `localhost`/`127.0.0.1` pronunciation prep + local TTS.
  - **Gemini TTS (Opt-in, Off by default):** API key stored only in OS keyring (Windows Credential Manager / Linux `libsecret`), pre-send confirmation prompt, and zero silent provider fallback.
- **Build & Packaging:** See [docs/DERLEME.md](docs/DERLEME.md) for Windows 11 (`.msi` / `.exe` / portable `.zip`) and CachyOS / Arch Linux (`AppImage` / `PKGBUILD`) instructions.

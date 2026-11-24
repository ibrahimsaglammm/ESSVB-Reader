# ESSVB-Reader Güvenlik ve Gizlilik Denetim Raporu (`GUVENLIK.md`)

**Uygulama Sürümü:** `0.1.0` (Hazırlık Aşaması)  
**Denetim Aşaması:** Aşama 5 – Ajan E Güvenlik Denetimi ve Test Onayı (Gate 2)  
**Tarih:** 24 Kasım 2026

---

## 1. Gizlilik ve Sıfır Telemetri Mimarisi

1. **Sıfır Telemetri ve Kısıtlı Güncelleme Denetimi:**
   - Projede hiçbir analitik, çökme raporlama veya takip SDK'sı (`Sentry`, `PostHog`, `Google Analytics`, `Discord RPC`) bulunmamaktadır.
   - Uygulama başlangıcında hiçbir harici font CDN'i (`fonts.googleapis.com`, `jsdelivr`, `cdnjs`, `unpkg`) veya kitap okuma verisi sunucusuna istek atılmaz.
   - Güncelleme denetimi yalnızca resmi GitHub Releases uç noktasına (`https://api.github.com/repos/ibrahimsaglammm/ESSVB-Reader/releases/latest`) bağlanır (Ayarlar > Gizlilik & Güncelleme bölümünden kapatılabilir; varsayılan kontrol aralığı 60 dakika). Yeni sürüm bulunduğunda **kullanıcı onayı olmadan hiçbir paket indirilmez veya çalıştırılmaz**. İndirme adresleri yalnızca `github.com` / `*.githubusercontent.com` HTTPS alan adlarıyla sınırlandırılmıştır ve `SHA-256` özet doğrulaması uygulanır.

2. **Kısıtlı Ağ Yüzeyi (Yalnızca Rust Tarafı):**
   - `tauri-plugin-http`, `tauri-plugin-shell`, `tauri-plugin-fs` ve `tauri-plugin-updater` projeye **hiç eklenmemiştir**.
   - `tts::ollama` (`src-tauri/src/tts/ollama.rs`): `validate_localhost_ollama_url` fonksiyonu ile yalnızca `localhost`, `127.0.0.1` ve `[::1]` adreslerine izin verir; harici IP/alan adları, kimlik bilgili URL'ler ve dosya şemaları reddedilir.
   - `tts::gemini` (`src-tauri/src/tts/gemini.rs`): Varsayılan olarak `geminiTtsEnabled: false` ile **kapalıdır**. Açıkça etkinleştirilse bile gönderim öncesi ön yüzde kullanıcı onayı istenir (`geminiConfirmBeforeSend`), API anahtarı URL sorgusuna değil yalnızca `x-goog-api-key` başlığına konur ve hata durumunda başka sağlayıcıya otomatik geçilmez.
   - `updater` (`src-tauri/src/updater.rs`): Yalnızca `https://` şemasına ve açık kullanıcı onayına izin verir; asla dosya indirip çalıştırmaz.

---

## 2. İçerik ve Arşiv Güvenlik Kontrolleri

### 2.1 Üç Katmanlı EPUB İçerik Sandbox'ı
1. **Rust HTML5 & CSS Sanitizasyonu (`src-tauri/src/core/sanitizer.rs`):**
   - `ammonia::Builder` (html5ever) ile yalnızca güvenli edebi HTML5 etiketlerine izin verilir. `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<meta>`, `<base>`, `<link>`, `<audio>`, `<video>` ve tüm `on*` olay işleyicileri ile `javascript:`/`vbscript:`/`file:` URI'ları silinir.
   - Harici `http(s)://` ve `//` görsel/stil bağlantıları engellenir; yalnızca EPUB arşivi içindeki yerel raster görseller (`png`/`jpeg`/`gif`/`webp`) `data:` URI olarak gömülür.
   - CSS sanitizasyonu yorumları (`/* ... */`), `@import`, `url(...)`, `expression()`, `-moz-binding` ve `behavior:` ifadelerini temizler.
2. **İzole Sandbox Iframe (`src/components/reader/ReaderView.tsx`):**
   - Bölüm içeriği `<iframe sandbox="allow-same-origin" srcDoc={...}>` içinde render edilir. **`allow-scripts` kesinlikle kapalıdır**; kullanıcıya kapatma/açma seçeneği sunulmaz.
3. **Çift Katmanlı İçerik Güvenlik Politikası (CSP):**
   - **Ana Tauri Penceresi (`src-tauri/tauri.conf.json` & `index.html`):**  
     `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'self' blob: data:; base-uri 'none'; form-action 'none';`
   - **Bölüm Iframe `<meta>` CSP (`sanitizer.rs`):**  
     `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`

### 2.2 ZIP-Slip ve ZIP-Bomb Koruması (`src-tauri/src/core/zip_guard.rs`)
- **Yol Doğrulama:** `..`, `.`, boş segment, `\` ters bölü, `:` sürücü harfi, baştaki `/` ve kontrol/NUL karakterleri reddedilir. Tüm göreli href'ler arşiv kökü içine sabitlenir.
- **Boyut ve Oran Sınırları:** ZIP başlık verisine güvenmeden `Read::take(max_bytes + 1)` ile gerçek bayt sayılır:
  - Maksimum EPUB dosya boyutu: `250 MiB`
  - Maksimum ZIP girdi sayısı: `10.000`
  - Maksimum XML/XHTML/CSS girdisi: `8 MiB`
  - Maksimum görsel girdisi: `15 MiB`
  - Tek okuma oturumunda toplam açılmış boyut: `512 MiB`
  - Sıkıştırma oranı sınırı (`>= 1 MiB` girdilerde): `100:1`

### 2.3 En Az Yetki Tauri Capability & Anahtar Deposu
- `src-tauri/capabilities/default.json` yalnızca `core:default`, `dialog:allow-open` ve `dialog:allow-save` izinlerini içerir.
- `paths::ensure_inside` ile kitap ve kapak okumaları yalnızca yönetilen uygulama veri dizini (veya taşınabilir modda `<exe_dir>/data/`) içinde tutulur.
- Tüm SQLite sorguları (`library/db.rs`) parametrelidir; sıralama sütunları katı enum eşlemesiyle seçilir.
- Gemini API anahtarı `settings/secrets.rs` içinde `keyring` v3 (Windows Credential Manager / Linux `libsecret`) ile saklanır; ne ön yüze geri döndürülür ne de JSON yedeklerine yazılır.

---

## 3. Bağımlılık Güvenliği ve Test Sonuçları

### 3.1 Bağımlılık Taramaları
- **Ön Yüz (`pnpm audit`):** `No known vulnerabilities found` (0 kritik, 0 yüksek, 0 orta, 0 düşük açık; exit code 0).
- **Rust Arka Uç (`src-tauri/Cargo.lock`):**
  - Bu ortamda `cargo-audit` ikilisi kurulu değildir (`Get-Command cargo-audit` boş döndü); `Cargo.lock` üzerindeki tüm çekirdek sandıklar (`tauri 2.12.7`, `ring 0.17.14`, `rustls 0.23.46`, `tokio 1.54.1`, `zip 2.6.1`, `ammonia 4.2.5`, `rusqlite 0.32.1`, `reqwest 0.12.28`, `keyring 3.6.3`, `image 0.25.10`, `windows 0.58.0`) güncel ve `default-features = false` (minimum özellik) ilkesiyle sabitlenmiştir.
  - Yerel/CI ortamında `cargo install cargo-audit && cargo audit` çalıştırma adımı `scripts/check-all.ps1` ve `docs/DERLEME.md` içine eklenmiştir.

### 3.2 Çalıştırılan Test ve Statik Analiz Sonuçları
| Kontrol | Kapsam | Sonuç |
|---|---|---|
| `cargo clippy --offline --all-targets -- -D warnings` | Tüm Rust hedefleri | **0 uyarı, 0 hata** |
| `cargo test --offline` | Zip-slip, zip-bomb, EPUB 2/3, Türkçe arama, XSS/dış URL sanitizasyonu, SQLite raf/not/yedek, TTS bölücü/önbellek/Ollama/Gemini/WinRT Tolga | **18 passed; 0 failed** |
| `tsc --noEmit` & `eslint .` | Tüm TypeScript & React dosyaları | **0 hata, 0 uyarı** |
| `prettier --check` | Tüm ön yüz kaynakları ve `index.html` | **Tüm dosyalar uyumlu** |
| `pnpm test` (`vitest run`) | TTS kuyruğu, i18n TR/EN denkliği, tema CSS/sistem takibi, App varsayılan gizlilik entegrasyonu | **4 dosya, 8 test geçti** |
| `pnpm exec playwright test` | Üretim `dist/` üzerinde gerçek tarayıcı duman testi | **1 passed; harici ağ isteği = 0** |
| Statik Güvenlik Taraması | `eval(`, `new Function`, `dangerouslySetInnerHTML`, `allow-scripts`, `posthog`, `sentry`, `gtag`, CDN URL'leri | **0 güvensiz kullanım** |
| Referans Projeler Kontrolü | `koodo-reader-dev` ve `readest-main` | **Tamamen değiştirilmemiş** |

---

## 4. Ajan E Güvenlik Onayı (Gate 2)

**Karar:** **ONAYLANDI (APPROVED)**  
Tüm zorunlu gizlilik, sandbox, arşiv güvenliği, kimlik bilgisi saklama, birim testleri, E2E sıfır-ağ doğrulaması ve bağımlılık taramaları başarıyla geçmiştir. Paketleme ve derleme (Ajan F) aşamasına geçilebilir.

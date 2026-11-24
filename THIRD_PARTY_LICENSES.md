# Üçüncü Parti Lisanslar / Third-Party Licenses

**ESSVB-Reader** (`v0.1.0`) temiz oda (clean-room) yaklaşımıyla **MIT** lisansı altında sıfırdan geliştirilmiştir. Referans alınan `koodo-reader-dev` ve `readest-main` projelerinden (her ikisi de AGPL-3.0) **hiçbir kaynak kodu, stil dosyası, yerelleştirme veya ikili varlık kopyalanmamıştır**.

Aşağıda `src-tauri/Cargo.lock` ve `pnpm-lock.yaml` kilit dosyalarından doğrulanan doğrudan ve kritik bağımlılıklar listelenmiştir:

## 1. Rust Arka Uç Bağımlılıkları (`src-tauri/Cargo.lock`)

| Paket | Sürüm | Lisans (SPDX) | Kullanım Amacı |
|---|---|---|---|
| `tauri` | `2.12.7` | `MIT OR Apache-2.0` | Çapraz platform masaüstü kabuğu ve katı capability ACL |
| `tauri-plugin-dialog` | `2.8.4` | `MIT OR Apache-2.0` | Kullanıcının seçtiği dosya/klasör açma ve kaydetme diyalogları |
| `rusqlite` | `0.32.1` | `MIT` | Gömülü SQLite kütüphane, raf, etiket ve not veritabanı |
| `zip` | `2.6.1` | `MIT` | EPUB ZIP arşivi okuma (`default-features = false`, yalnızca `deflate`) |
| `quick-xml` | `0.37.5` | `MIT` | `container.xml`, OPF 2/3, NCX, Nav XML ayrıştırma |
| `ammonia` | `4.2.5` | `MIT OR Apache-2.0` | `html5ever` tabanlı katı EPUB HTML5 XSS sanitizasyonu |
| `image` | `0.25.10` | `MIT OR Apache-2.0` | Kapak küçük resmi oluşturma (`jpeg`, `png`, `gif`, `webp`) |
| `reqwest` | `0.12.28` | `MIT OR Apache-2.0` | Yalnızca `rustls-tls` ile isteğe bağlı Ollama/Gemini/güncelleme HTTP |
| `rustls` | `0.23.46` | `Apache-2.0 OR ISC OR MIT` | Saf Rust TLS (OpenSSL bağımlılığı yok) |
| `ring` | `0.17.14` | `LicenseRef-ring` (ISC/OpenSSL türevi) | `rustls` kriptografik ilkelleri |
| `tokio` | `1.54.1` | `MIT` | Asenkron görev yürütücü |
| `windows` | `0.58.0` | `MIT OR Apache-2.0` | Windows 11 WinRT `SpeechSynthesis` (`Microsoft Tolga`) |
| `keyring` | `3.6.3` | `MIT OR Apache-2.0` | İşletim sistemi anahtar deposu (Credential Manager / `libsecret`) |
| `serde` / `serde_json` | `1.0.229` / `1.0.154` | `MIT OR Apache-2.0` | IPC veri serileştirme ve JSON yedekleme |
| `thiserror` | `2.0.21` | `MIT OR Apache-2.0` | Yapısal hata türleri |
| `sha2` / `hex` / `base64` | `0.10.9` / `0.4.3` / `0.22.1` | `MIT OR Apache-2.0` | Dosya/önbellek özetleri ve gömülü veri kodlama |
| `uuid` | `1.29.3` | `Apache-2.0 OR MIT` | Kitap, raf ve not kimlikleri |
| `chrono` | `0.4.45` | `MIT OR Apache-2.0` | Zaman damgaları |
| `url` / `percent-encoding` / `semver` | `2.5.9` / `2.3.2` / `1.0.28` | `MIT OR Apache-2.0` | URL doğrulama, yol çözme, sürüm karşılaştırma |

## 2. Ön Yüz ve Geliştirme Bağımlılıkları (`package.json` / `pnpm-lock.yaml`)

| Paket | Sürüm | Lisans (SPDX) | Kullanım Amacı |
|---|---|---|---|
| `react` / `react-dom` | `19.2.0` | `MIT` | Kullanıcı arayüzü kütüphanesi |
| `zustand` | `5.0.8` | `MIT` | Uygulama durum yönetimi |
| `@tauri-apps/api` | `2.12.5` | `MIT OR Apache-2.0` | Tauri IPC istemci köprüsü |
| `@tauri-apps/plugin-dialog` | `2.8.4` | `MIT OR Apache-2.0` | Dosya seçim köprüsü |
| `lucide-react` | `0.553.0` | `ISC` | Yerel paketlenmiş SVG simgeler (CDN isteği yok) |
| `vite` / `@vitejs/plugin-react` | `7.3.8` / `5.1.1` | `MIT` | Üretim paketleyici |
| `typescript` | `5.9.3` | `Apache-2.0` | Statik tip denetimi |
| `vitest` / `@testing-library/react` | `4.1.12` / `16.3.0` | `MIT` | Ön yüz birim testleri |
| `@playwright/test` | `1.56.1` | `Apache-2.0` | Uçtan uca duman testi |
| `eslint` / `typescript-eslint` / `prettier` | `10.15.0` / `8.74.0` / `3.6.2` | `MIT` | Kod kalitesi ve biçimlendirme |
| `@tauri-apps/cli` | `2.12.6` | `MIT OR Apache-2.0` | Masaüstü derleme ve paketleme |

*(Tam geçişli bağımlılık grafiği proje kökündeki `pnpm-lock.yaml` ve `src-tauri/Cargo.lock` dosyalarında sabitlenmiştir. Tüm bağımlılıklar MIT/Apache-2.0/ISC uyumludur; AGPL/GPL bulaşıcı bağımlılık içermez.)*

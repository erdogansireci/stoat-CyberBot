# Stoat CyberBot

Stoat.chat için geliştirilmiş, ses kanalına bağlanıp YouTube linklerini çalabilen basit bir müzik botu.

## Özellikler

- `ping` kontrol komutu
- Voice kanalına bağlanma
- YouTube linkini kuyruğa ekleyip çalma
- Şarkı atlama, durdurma, kuyruk listeleme

## Gereksinimler

- Node.js `18+` (önerilen: `20+`)
- `yt-dlp` sistemde kurulu olmalı ve terminalden çalışmalı
- Stoat bot token

## Kurulum

```bash
npm install
```

`.env` dosyası oluştur:

```env
STOAT_BOT_TOKEN=BOT_TOKEN_HERE
PREFIX=!
```

## Çalıştırma

```bash
npm start
```

Başarılı başlatmada terminalde `Bot online: ...` logu görünür.

## Komutlar

Varsayılan prefix: `!` ( `.env` içindeki `PREFIX` ile değiştirilebilir )

- `!ping`  
  Botun ayakta olup olmadığını kontrol eder.

- `!join <voiceChannelId>`  
  Botu verilen voice kanalına bağlar.

- `!play <youtube_link>`  
  YouTube linkini kuyruğa ekler, boşsa hemen çalmaya başlar.

- `!skip`  
  O anki parçayı atlar ve sıradakine geçer.

- `!stop`  
  Çalmayı durdurur ve kuyruğu temizler.

- `!queue`  
  Kuyruktaki ilk 10 girdiyi listeler.

## Kullanım örneği

```text
!join 1234567890abcdef
!play https://www.youtube.com/watch?v=dQw4w9WgXcQ
!queue
!skip
!stop
```

## Notlar

- `!play` komutu şu an yalnızca doğrudan YouTube linki kabul eder.
- Kuyruk bellekte tutulur, bot yeniden başlatılırsa sıfırlanır.
- `yt-dlp` kurulu değilse çalma komutu hata verir.

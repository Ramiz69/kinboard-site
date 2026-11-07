# Kinboard - сайт

Лендинг, политика конфиденциальности и поддержка приложения Kinboard
(экран семьи для Apple TV, iPad и iPhone). Код приложения - в отдельном
закрытом репозитории.

| Адрес | Файл |
|---|---|
| `/` | `public/index.html` |
| `/privacy/` | `public/privacy/index.html` |
| `/support/` | `public/support/index.html` |

На `/privacy/` и `/support/` ведут ссылки из App Store Connect и из
приложения - адреса не менять.

## Публикация

Cloudflare Workers Builds выкладывает `public/` как есть (`wrangler.jsonc`,
`assets.directory = ./public`), шага сборки нет. **Пуш в `main` публикует
сайт.** Предпросмотр локально:

```sh
npx wrangler dev
```

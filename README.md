# Ikariam Builder — ERP Analítico

Chrome Extension (MV3) + scraper Playwright para coleta e análise de dados do Ikariam.

---

## Documentação

| Arquivo | O que contém |
|---|---|
| [BUSINESS.md](BUSINESS.md) | Módulos de negócio, métricas, glossário, o que o ERP calcula |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Módulos técnicos, fluxo de dados, regras de implementação |
| [SCRAPER.md](SCRAPER.md) | Views, seletores confirmados, parsing, status de cobertura |
| [ENDPOINTS.md](ENDPOINTS.md) | Endpoints HTTP do jogo, actions, POST/GET, parâmetros |
| [GAME_MODEL.md](GAME_MODEL.md) | Estrutura do objeto JS do jogo (`ikariam.*`, `bgViewData`) |
| [UI.md](UI.md) | Spec de painéis, componentes, contratos de dados UI |

---

## Como rodar o scraper

```bash
node scraper_explore.mjs
```

Requer sessão ativa no browser profile (`./browser_profile`).
Se expirada, o browser abre o lobby para login manual.

Saída:
- `scraper_report.json` — dados coletados de todas as cidades
- `scraper_dumps/*.html` — HTML bruto de cada view para auditoria

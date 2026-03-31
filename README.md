# Ikariam Builder

Extensão Chrome MV3 para automação operacional do Ikariam, com núcleo de decisão por fases, fila de execução e painel de observabilidade.

## Entrada rápida para agentes

- Entrypoint de contexto: [AGENTS.md](AGENTS.md)
- Índice operacional central: [docs/INDEX.md](docs/INDEX.md)
- Roteamento por tipo de task: [docs/ROUTING.md](docs/ROUTING.md)

## Domínios principais

- Boot/injeção e bridges: [content/content.js](content/content.js), [inject/inject.js](inject/inject.js), [background/background.js](background/background.js)
- Coleta e estado: [modules/DataCollector.js](modules/DataCollector.js), [modules/StateManager.js](modules/StateManager.js)
- Execução e orquestração: [modules/GameClient.js](modules/GameClient.js), [modules/TaskQueue.js](modules/TaskQueue.js), [modules/Planner.js](modules/Planner.js)
- Negócio: [modules/CFO.js](modules/CFO.js), [modules/COO.js](modules/COO.js), [modules/HR.js](modules/HR.js), [modules/CTO.js](modules/CTO.js), [modules/CSO.js](modules/CSO.js), [modules/MnA.js](modules/MnA.js)
- UI/observabilidade: [modules/UIBridge.js](modules/UIBridge.js), [ui/panel.js](ui/panel.js), [modules/Audit.js](modules/Audit.js), [modules/HealthCheckRunner.js](modules/HealthCheckRunner.js)

## Qual documento abrir conforme a mudança

- Mapa mestre e arquivos críticos: [docs/INDEX.md](docs/INDEX.md)
- Onde mexer para cada tipo de mudança: [docs/ROUTING.md](docs/ROUTING.md)
- Arquitetura operacional real (confirmada no código): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Impacto colateral por alteração: [docs/CHANGE_MAP.md](docs/CHANGE_MAP.md)
- Regras confirmadas, inferências e lacunas: [docs/VALIDATED_RULES.md](docs/VALIDATED_RULES.md)

## Execução de testes

- Testes unitários: `npm test`
- Watch: `npm run test:watch`
- Cobertura: `npm run test:coverage`

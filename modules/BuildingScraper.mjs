/**
 * BuildingScraper.mjs
 * Módulo de scraping de edifícios via AJAX para o Ikariam ERP analítico.
 *
 * Estratégia:
 *   1. Lê bgViewData.position[] da city view já carregada
 *   2. Para cada edifício real, chama o endpoint AJAX:
 *      GET /index.php?view={building}&cityId={id}&position={groundId}&ajax=1
 *   3. Extrai HTML do payload changeView, faz parse dos campos
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SELETORES POR EDIFÍCIO (confirmados via AJAX)
 *
 * Fonte: bgViewData.position[] → building_type → ajax endpoint
 *
 * | Edifício      | view param    | seletor nível | seletor custos    | observações          |
 * |---------------|---------------|---------------|-------------------|----------------------|
 * | townHall      | townHall      | A CONFIRMAR   | ul.resources li   | -                    |
 * | academy       | academy       | A CONFIRMAR   | ul.resources li   | tem cientistas       |
 * | warehouse     | warehouse     | A CONFIRMAR   | ul.resources li   | tem capacidade       |
 * | tavern        | tavern        | A CONFIRMAR   | ul.resources li   | tem wine service     |
 * | museum        | museum        | A CONFIRMAR   | ul.resources li   | -                    |
 * | palace        | palace        | A CONFIRMAR   | ul.resources li   | capital only         |
 * | palaceColony  | palaceColony  | A CONFIRMAR   | ul.resources li   | colônia              |
 * | port          | port          | A CONFIRMAR   | ul.resources li   | múltiplas posições   |
 * | barracks      | barracks      | A CONFIRMAR   | ul.resources li   | -                    |
 * | shipyard      | shipyard      | A CONFIRMAR   | ul.resources li   | -                    |
 * | glassblowing  | glassblowing  | A CONFIRMAR   | ul.resources li   | recurso especial     |
 * | forester      | forester      | A CONFIRMAR   | ul.resources li   | recurso especial     |
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Constantes de recursos ────────────────────────────────────────────────────

const RESOURCE_CLASSES = ['wood', 'wine', 'marble', 'crystal', 'sulfur'];

// ── parseIkariamNumber ────────────────────────────────────────────────────────

/**
 * Converte texto de número no formato Ikariam para um valor JS.
 *
 * Regras:
 *   "1.928"      → 1928
 *   "+1.332"     → 1332
 *   "-3.052"     → -3052
 *   "0.00"       → 0
 *   "2,93M"      → 2930000
 *   "1,5K"       → 1500
 *   "313 + 156"  → { raw: "313 + 156", parts: [313, 156], sum: 469, meaning: "unknown_until_validated" }
 *
 * NUNCA colapsa "313 + 156" em 313156 — o campo composto precisa validação manual.
 *
 * @param {string|null} raw
 * @returns {number|object|null}
 */
export function parseIkariamNumber(raw) {
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim();
  if (s === '') return null;

  // Normaliza espaços internos para detectar padrões compostos
  const normalized = s.replace(/\s+/g, ' ');

  // Campo composto: "313 + 156" ou "+313 + 156" etc.
  // Detecta antes de qualquer outra coisa para não colapsar
  const compoundMatch = normalized.match(/^([+-]?[\d.,]+)\s*\+\s*([+-]?[\d.,]+)$/);
  if (compoundMatch) {
    const parseSingle = (str) => {
      const clean = str.trim().replace(/\./g, '').replace(',', '.');
      const n = parseFloat(clean);
      return isNaN(n) ? null : n;
    };
    const part0 = parseSingle(compoundMatch[1]);
    const part1 = parseSingle(compoundMatch[2]);
    const parts = [part0, part1].filter(p => p !== null);
    return {
      raw: normalized,
      parts,
      sum: parts.reduce((acc, v) => acc + v, 0),
      meaning: 'unknown_until_validated',
    };
  }

  // Remove espaços para processar o restante
  const noSpace = normalized.replace(/\s/g, '');

  // Milhões: "2,93M" ou "2.93M"
  if (/M$/i.test(noSpace)) {
    const val = parseFloat(noSpace.replace(/[Mm]$/, '').replace(',', '.'));
    return isNaN(val) ? null : Math.round(val * 1_000_000);
  }

  // Milhares: "1,5K" ou "1.5K"
  if (/K$/i.test(noSpace)) {
    const val = parseFloat(noSpace.replace(/[Kk]$/, '').replace(',', '.'));
    return isNaN(val) ? null : Math.round(val * 1_000);
  }

  // Sinal explícito + separador de milhar com ponto: "+1.332", "-3.052", "1.928"
  // Ikariam usa ponto como separador de milhar e vírgula como decimal
  // Heurística: se tem ponto e os grupos têm 3 dígitos → separador de milhar
  // Se tem vírgula → decimal
  const hasThousandDot = /^\+?-?[\d]{1,3}(\.\d{3})+$/.test(noSpace.replace(/^[+-]/, '').length > 0 ? noSpace : noSpace);
  // Mais simples: remove pontos de milhar, troca vírgula por ponto decimal
  // Detecta se ponto é milhar: o último grupo após ponto tem exatamente 3 dígitos e não há vírgula
  let cleaned = noSpace;

  if (/,/.test(cleaned)) {
    // Tem vírgula — vírgula é decimal, ponto é milhar
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/\./.test(cleaned)) {
    // Só tem ponto
    const parts = cleaned.split('.');
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 3 && parts.length > 1) {
      // Ponto é separador de milhar (todos os grupos decimais têm 3 dígitos)
      const allThousands = parts.slice(1).every(p => p.length === 3);
      if (allThousands) {
        cleaned = cleaned.replace(/\./g, ''); // remove todos os pontos
      }
      // caso contrário, trata ponto como decimal (ex.: "0.00")
    }
    // se lastPart.length !== 3, ponto é decimal — não altera
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? raw : n;
}

// ── fetchBuildingAjax ─────────────────────────────────────────────────────────

/**
 * Busca o payload AJAX de um edifício mantendo os cookies da sessão do browser.
 *
 * @param {import('playwright').Page} page          - Página Playwright com sessão ativa
 * @param {string}                    serverBase     - Ex.: "https://s73-br.ikariam.gameforge.com"
 * @param {string}                    view           - Ex.: "townHall", "academy"
 * @param {number|string}             cityId
 * @param {number|string}             position       - groundId do slot
 * @returns {Promise<Array|null>}                    - Array JSON bruto ou null em caso de erro
 */
export async function fetchBuildingAjax(page, serverBase, view, cityId, position) {
  const endpoint = `${serverBase}/index.php?view=${encodeURIComponent(view)}&cityId=${encodeURIComponent(cityId)}&position=${encodeURIComponent(position)}&ajax=1`;

  const result = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
      const text = await res.text();
      try {
        return { error: null, data: JSON.parse(text) };
      } catch (parseErr) {
        return { error: `JSON parse error: ${parseErr.message}`, data: null, raw: text.slice(0, 300) };
      }
    } catch (fetchErr) {
      return { error: fetchErr.message, data: null };
    }
  }, endpoint);

  if (result.error) {
    return { ok: false, error: result.error, raw: result.raw ?? null, endpoint };
  }
  return { ok: true, data: result.data, endpoint };
}

// ── parseChangeViewPayload ────────────────────────────────────────────────────

/**
 * Extrai o HTML do edifício a partir do array JSON retornado pelo endpoint AJAX.
 *
 * O array contém tuplas onde o primeiro elemento é o nome da ação.
 * A ação "changeView" contém o HTML na posição [1][1].
 *
 * @param {Array} ajaxData - Array JSON bruto da resposta AJAX
 * @returns {{ html: string|null, found: boolean }}
 */
export function parseChangeViewPayload(ajaxData) {
  if (!Array.isArray(ajaxData)) {
    return { html: null, found: false, error: 'ajaxData is not an array' };
  }

  const entry = ajaxData.find(d => Array.isArray(d) && d[0] === 'changeView');
  if (!entry) {
    return { html: null, found: false };
  }

  // Estrutura esperada: ['changeView', [viewName, htmlString, ...]]
  const html = entry?.[1]?.[1];
  if (typeof html !== 'string') {
    return { html: null, found: true, error: 'changeView entry found but HTML not at [1][1]' };
  }

  return { html, found: true };
}

// ── parseBuildingHTML ─────────────────────────────────────────────────────────

/**
 * Extrai dados estruturados do HTML de um edifício.
 *
 * Processado via page.evaluate + DOMParser para reutilizar o engine do browser
 * sem depender de jsdom no Node.
 *
 * @param {import('playwright').Page} page
 * @param {string}                    html         - HTML string retornado pelo AJAX
 * @param {string}                    buildingType - Ex.: "townHall"
 * @returns {Promise<object>}
 */
export async function parseBuildingHTML(page, html, buildingType) {
  const result = await page.evaluate(({ html, buildingType, resourceClasses }) => {
    const errors = [];

    let doc;
    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(html, 'text/html');
    } catch (e) {
      return {
        level: null,
        upgrade_costs: null,
        upgrade_time: null,
        next_level_effect: null,
        queue_active: null,
        prerequisites: [],
        raw_html_snippet: html.slice(0, 300),
        parse_errors: [`DOMParser failed: ${e.message}`],
      };
    }

    // ── Helpers locais ────────────────────────────────────────────────────────

    function textOf(selector) {
      const el = doc.querySelector(selector);
      if (!el) return null;
      // Remove .accesshint antes de ler textContent
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.accesshint').forEach(n => n.remove());
      return clone.textContent?.trim() || null;
    }

    function firstText(...selectors) {
      for (const sel of selectors) {
        const t = textOf(sel);
        if (t) return { value: t, selector: sel };
      }
      return { value: null, selector: null };
    }

    // ── Nível: NÃO extrair do HTML AJAX ──────────────────────────────────────
    // O nível oficial vem do position_json (bgViewData). O HTML AJAX contém o
    // nível atual formatado em texto sujo ("Melhorar\n...Nível 18") e não é
    // confiável para extração. Deixamos null aqui; o chamador usa pos.level.

    // ── Custos de upgrade ─────────────────────────────────────────────────────
    const upgrade_costs = { wood: 0, wine: 0, marble: 0, crystal: 0, sulfur: 0, gold: 0 };
    let costsFound = false;

    try {
      const costItems = doc.querySelectorAll('ul.resources li');
      if (costItems.length > 0) {
        costsFound = true;
        costItems.forEach(li => {
          const clone = li.cloneNode(true);
          clone.querySelectorAll('.accesshint').forEach(n => n.remove());
          const text = clone.textContent?.trim() || '';

          // Detecta recurso pela classe do <li> ou de filho <img>/<span>
          let resourceType = null;
          for (const cls of resourceClasses) {
            if (li.classList.contains(cls)) { resourceType = cls; break; }
          }
          if (!resourceType) {
            // Tenta pelo atributo class de filhos
            for (const cls of resourceClasses) {
              if (li.querySelector(`.${cls}`)) { resourceType = cls; break; }
            }
          }
          if (!resourceType) {
            // Tenta ouro
            if (li.classList.contains('gold') || li.querySelector('.gold')) resourceType = 'gold';
          }

          if (resourceType && text) {
            // Remove separadores de milhar (pontos) e converte
            const clean = text.replace(/\./g, '').replace(',', '.');
            const val = parseFloat(clean);
            if (!isNaN(val)) upgrade_costs[resourceType] = val;
            else errors.push(`Não parsou custo de ${resourceType}: "${text}"`);
          }
        });
      } else {
        errors.push('ul.resources li: nenhum item encontrado');
      }
    } catch (e) {
      errors.push(`Erro ao parsear custos: ${e.message}`);
    }

    // ── Tempo de upgrade ──────────────────────────────────────────────────────
    // Seletor confirmado: li.time (contém "6h 13m" com tooltip após whitespace)
    // Fallback: [class*="upgradeTime"], [class*="duration"] (container mais largo)
    const upgradeTimeResult = firstText(
      'li.time',
      '[class*="upgradeTime"]',
      '#upgradeTime',
      '[id*="upgradeTime"]',
    );

    let upgrade_time_text = null;
    let upgrade_time_seconds = null;
    if (upgradeTimeResult.value) {
      // Extrai só tokens com dígito, colapsando whitespace excessivo
      // Remove linhas de tooltip/bônus que vêm depois do valor principal
      const tokens = upgradeTimeResult.value
        .split(/[\n\r]/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && /\d/.test(l));

      // Reconstrói: junta tokens que formam a duração (ex: ["6h 13m"] ou ["7", "Dias"])
      // Para porto: "Duração : 7 Dias" → tokens podem ser ["7", "Dias"] ou separados
      // Para prédios normais: "6h 13m" → primeiro token já é o valor
      const rawTime = tokens[0] ?? '';
      // Se o raw parece só um número, inclui o próximo token (unidade)
      upgrade_time_text = /^\d+$/.test(rawTime) && tokens[1]
        ? `${rawTime} ${tokens[1]}`
        : rawTime;

      // Converte para segundos
      try {
        let secs = 0;
        const d = upgrade_time_text.match(/(\d+)\s*[Dd](?:ia|ay)?/i);
        const h = upgrade_time_text.match(/(\d+)\s*h/i);
        const m = upgrade_time_text.match(/(\d+)\s*m(?:in)?(?!\s*s)/i);
        const s = upgrade_time_text.match(/(\d+)\s*s(?:eg)?/i);
        if (d) secs += parseInt(d[1]) * 86400;
        if (h) secs += parseInt(h[1]) * 3600;
        if (m) secs += parseInt(m[1]) * 60;
        if (s) secs += parseInt(s[1]);
        if (secs > 0) upgrade_time_seconds = secs;
      } catch (_) {}
    }

    // ── Efeito do próximo nível — seletores confirmados via inspeção do HTML AJAX ─
    //
    // MAPEAMENTO CONFIRMADO (inspecionado em 29/03/2026):
    //
    // | Prédio        | Seletor                                  | Tipo         | Status                  |
    // |---------------|------------------------------------------|--------------|-------------------------|
    // | warehouse     | #informationSidebar td.amount:first-child| capacity     | CONFIRMED               |
    // | carpentering  | #informationSidebar td.center            | reduction    | CONFIRMED               |
    // | forester      | #informationSidebar td.info.center       | percent      | CONFIRMED               |
    // | glassblowing  | #informationSidebar td.info.center       | percent      | CONFIRMED               |
    // | stonemason    | #informationSidebar td.info.center       | percent      | CONFIRMED               |
    // | alchemist     | #informationSidebar td.info.center       | percent      | CONFIRMED               |
    // | palaceColony  | #informationSidebar (texto inline)        | percent      | CONFIRMED (valor ~-0%)  |
    // | academy       | NOT_EXPOSED — derivar via #valueResearch | production   | REQUIRES_DERIVATION     |
    // | tavern        | NOT_EXPOSED — max option de #wineAmount  | capacity     | REQUIRES_DERIVATION     |
    // | museum        | NOT_EXPOSED — sem elemento estruturado   | unknown      | NOT_EXPOSED_IN_AJAX     |
    // | palace        | NOT_EXPOSED — texto descritivo           | unknown      | NOT_EXPOSED_IN_AJAX     |
    // | port          | NOT_EXPOSED — sem elemento estruturado   | unknown      | NOT_EXPOSED_IN_AJAX     |

    let next_level_effect_raw = null;
    let next_level_effect_parsed = null;
    let effect_type = 'unknown';
    let next_level_effect_selector = null;

    try {
      // Grupo 1: #informationSidebar — prédios com bônus em % ou capacidade
      const sidebar = doc.querySelector('#informationSidebar');

      if (sidebar) {
        if (buildingType === 'warehouse') {
          // Retorna o primeiro td.amount (delta de capacidade por recurso — todos iguais)
          const amountEl = sidebar.querySelector('td.amount');
          if (amountEl) {
            next_level_effect_raw = amountEl.textContent.trim();
            next_level_effect_selector = '#informationSidebar td.amount';
            // fallback: '#informationSidebar .sidebar_table td.amount'
            const n = parseFloat(next_level_effect_raw.replace(/\./g, '').replace(',', '.').replace('+', ''));
            next_level_effect_parsed = isNaN(n) ? null : n;
            effect_type = 'capacity';
          }
        } else if (buildingType === 'carpentering') {
          // Padrão: primeira td.center é ícone vazio, segunda td.center tem "-27,00%"
          const els = [...sidebar.querySelectorAll('td.center')];
          const el = els.find(td => td.textContent.trim().length > 0);
          if (el) {
            next_level_effect_raw = el.textContent.trim();
            next_level_effect_selector = '#informationSidebar td.center';
            const n = parseFloat(next_level_effect_raw.replace(',', '.').replace('%', ''));
            next_level_effect_parsed = isNaN(n) ? null : n;
            effect_type = 'reduction';
          }
        } else if (['forester', 'glassblowing', 'stonemason', 'alchemist', 'winegrower'].includes(buildingType)) {
          // Padrão: primeira td.info.center é ícone vazio, segunda tem "+20%", "+26%", etc.
          const els = [...sidebar.querySelectorAll('td.info.center')];
          const el = els.find(td => td.textContent.trim().length > 0);
          if (el) {
            next_level_effect_raw = el.textContent.trim();
            next_level_effect_selector = '#informationSidebar td.info.center (non-empty)';
            const n = parseFloat(next_level_effect_raw.replace(',', '.').replace('%', '').replace('+', ''));
            next_level_effect_parsed = isNaN(n) ? null : n;
            effect_type = 'percent';
          }
        } else if (buildingType === 'palaceColony') {
          // Texto inline: "Corrupção: -0%"
          const content = sidebar.querySelector('.content');
          if (content) {
            next_level_effect_raw = content.textContent.replace(/\s+/g, ' ').trim();
            next_level_effect_selector = '#informationSidebar .content';
            // Extrai o valor percentual
            const m = next_level_effect_raw.match(/([-+]?\d+[,.]?\d*%)/);
            next_level_effect_parsed = m ? parseFloat(m[1].replace(',', '.').replace('%', '')) : null;
            effect_type = 'percent';
          }
        }
      }

      // Grupo 2: derivados — expostos em elementos operacionais, não no sidebar
      if (!next_level_effect_raw) {
        if (buildingType === 'academy') {
          // Produção atual de pesquisa: #valueResearch
          // O efeito do próximo nível não está exposto — requer derivação
          // Marcamos como REQUIRES_DERIVATION com o valor atual como referência
          const el = doc.querySelector('#valueResearch');
          if (el) {
            next_level_effect_raw = el.textContent.trim();
            next_level_effect_selector = '#valueResearch';
            const n = parseFloat(next_level_effect_raw.replace(/[^0-9.,-]/g, '').replace(',', '.'));
            next_level_effect_parsed = isNaN(n) ? null : n;
            effect_type = 'production';
            errors.push('academy: next_level_effect é REQUIRES_DERIVATION — valor atual de #valueResearch, não efeito do próximo nível');
          }
        } else if (buildingType === 'tavern') {
          // Max wine/h disponível no dropdown #wineAmount (último option)
          const options = [...doc.querySelectorAll('#wineAmount option')];
          if (options.length > 0) {
            const lastOpt = options[options.length - 1].textContent.trim();
            next_level_effect_raw = lastOpt;
            next_level_effect_selector = '#wineAmount option:last-child';
            const m = lastOpt.match(/(\d+)/);
            next_level_effect_parsed = m ? parseInt(m[1]) : null;
            effect_type = 'capacity';
            errors.push('tavern: next_level_effect é REQUIRES_DERIVATION — max option do dropdown, não próximo nível');
          }
        }
        // museum, palace, port: NOT_EXPOSED_IN_AJAX
      }
    } catch (e) {
      errors.push(`Erro ao extrair next_level_effect: ${e.message}`);
    }

    // ── Queue ativa ───────────────────────────────────────────────────────────
    // Indica se há construção em andamento (timer ou elemento de fila visível)
    let queue_active = false;
    try {
      const queueSelectors = [
        '[class*="buildingQueue"]',
        '[id*="queue"]',
        '[class*="constructionInfo"]',
        '.cancelUpgrade',
        '[class*="upgradeRunning"]',
        '[class*="timer"]',
      ];
      for (const sel of queueSelectors) {
        if (doc.querySelector(sel)) { queue_active = true; break; }
      }
    } catch (e) {
      errors.push(`Erro ao detectar queue: ${e.message}`);
    }

    // ── Pré-requisitos ────────────────────────────────────────────────────────
    const prerequisites = [];
    try {
      const prereqEls = doc.querySelectorAll('[class*="prerequisite"], [class*="requirement"], [class*="buildingPrerequisite"]');
      prereqEls.forEach(el => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.accesshint').forEach(n => n.remove());
        const t = clone.textContent?.trim();
        if (t) prerequisites.push(t);
      });
    } catch (e) {
      errors.push(`Erro ao parsear pré-requisitos: ${e.message}`);
    }

    return {
      upgrade_costs: costsFound ? upgrade_costs : null,
      upgrade_time_text,
      upgrade_time_seconds,
      upgrade_time_selector: upgradeTimeResult.selector,
      next_level_effect_raw,
      next_level_effect_parsed,
      effect_type,
      next_level_effect_selector,
      queue_active,
      prerequisites,
      raw_html_snippet: html.slice(0, 300),
      parse_errors: errors,
    };
  }, { html, buildingType, resourceClasses: RESOURCE_CLASSES });

  return result;
}

// ── scrapeBuildingsFromCity ───────────────────────────────────────────────────

/**
 * Scrapa todos os edifícios de uma cidade a partir da city view já carregada.
 *
 * Pré-condição: a página já deve estar na city view do cityId fornecido,
 * ou pelo menos ter o bgViewData disponível no contexto da página.
 *
 * @param {import('playwright').Page} page
 * @param {string}                    serverBase - Ex.: "https://s73-br.ikariam.gameforge.com"
 * @param {number|string}             cityId
 * @returns {Promise<Array>}          Array de objetos de edifício padronizados
 */
export async function scrapeBuildingsFromCity(page, serverBase, cityId, positionJson = null) {
  // ── 1. Resolve posições ───────────────────────────────────────────────────
  // Preferência: positionJson passado externamente (extraído durante scrapeCity,
  // enquanto o script inline ainda estava no DOM).
  // Fallback: tenta ler do DOM atual (funciona se a página ainda está na city view
  // e os scripts inline ainda não foram removidos).
  let rawPositions = positionJson;

  if (!rawPositions) {
    const result = await page.evaluate(() => {
      try {
        if (typeof bgViewData !== 'undefined' && Array.isArray(bgViewData.position)) {
          return bgViewData.position;
        }
        const scripts = [...document.querySelectorAll('script:not([src])')];
        for (const s of scripts) {
          const t = s.textContent || '';
          const i = t.indexOf('"updateBackgroundData"');
          if (i === -1) continue;
          const start = t.indexOf('{', i);
          if (start === -1) continue;
          let depth = 0, j = start;
          for (; j < t.length; j++) {
            if (t[j] === '{') depth++;
            else if (t[j] === '}') { depth--; if (depth === 0) break; }
          }
          try {
            const obj = JSON.parse(t.slice(start, j + 1));
            if (Array.isArray(obj.position)) return obj.position;
          } catch (_) {}
        }
        return null;
      } catch (e) { return null; }
    });
    rawPositions = result;
  }

  if (!rawPositions) {
    return [{ error: 'bgViewData.position não encontrado', cityId }];
  }

  const positions = rawPositions.map((pos, idx) => ({
    index: idx,
    buildingId: pos.buildingId ?? null,
    name: pos.name ?? null,
    level: pos.level ?? null,
    isBusy: pos.isBusy ?? false,
    canUpgrade: pos.canUpgrade ?? false,
    isMaxLevel: pos.isMaxLevel ?? false,
    building: pos.building ?? null,
    groundId: pos.groundId ?? idx,
    allowedBuildings: pos.allowedBuildings ?? [],
    isEmpty: pos.buildingId == null,
  }));

  const results = [];

  // ── 2. Itera sobre posições usando array_index como chave única ───────────
  //
  // CHAVE ÚNICA: cityId + array_index (posição serial 0..N no position[])
  //
  // Justificativa:
  //   - groundId NÃO é único: é o tipo de slot (1=litoral, 2=terra, 3=muralha…)
  //     Múltiplos edifícios compartilham o mesmo groundId (ex: 13 prédios com groundId=2)
  //   - buildingId NÃO é único: 3 armazéns têm o mesmo buildingId=7
  //   - building_type NÃO é único: dois portos, três armazéns
  //   - array_index É único por cidade: é a posição serial no array position[]
  //     e é também o parâmetro correto para o endpoint AJAX (position=N)
  //
  // Porto "duplicado": dois portos reais em array_index=1 e array_index=2,
  //   ambos com groundId=1 (slot litoral). São instâncias independentes.
  //   Cada um tem seu próprio endpoint: position=1 e position=2.

  for (let arrayIndex = 0; arrayIndex < positions.length; arrayIndex++) {
    const pos = positions[arrayIndex];

    if (pos.isEmpty || !pos.building || pos.building.startsWith('buildingGround')) {
      results.push({
        array_index: arrayIndex,
        slot_type: pos.building ?? 'unknown',
        ground_id: pos.groundId,
        building_type: null,
        building_id: null,
        name: null,
        level: null,
        can_upgrade: false,
        is_busy: false,
        is_max_level: false,
        upgrade_costs: null,
        upgrade_time_text: null,
        upgrade_time_seconds: null,
        next_level_effect_raw: null,
        next_level_effect_parsed: null,
        effect_type: 'unknown',
        prerequisites: [],
        queue_active: false,
        data_source: 'empty_slot',
        ajax_endpoint: null,
        parse_errors: [],
      });
      continue;
    }

    const buildingType = pos.building;
    const parseErrors = [];

    // array_index é o parâmetro position= correto para o endpoint AJAX
    const ajaxResult = await fetchBuildingAjax(page, serverBase, buildingType, cityId, arrayIndex);
    const ajaxEndpoint = ajaxResult.endpoint;

    // Base do objeto — level sempre vem do position_json
    const base = {
      array_index: arrayIndex,
      slot_type: `ground_${pos.groundId}`,
      ground_id: pos.groundId,
      building_type: buildingType,
      building_id: pos.buildingId,
      name: pos.name,
      level: pos.level ?? null,          // fonte oficial: position_json
      can_upgrade: pos.canUpgrade,
      is_busy: pos.isBusy,
      is_max_level: pos.isMaxLevel,
      ajax_endpoint: ajaxEndpoint,
    };

    if (!ajaxResult.ok) {
      results.push({ ...base, upgrade_costs: null, upgrade_time_text: null, upgrade_time_seconds: null,
        next_level_effect_raw: null, next_level_effect_parsed: null, effect_type: 'unknown',
        prerequisites: [], queue_active: pos.isBusy,
        data_source: 'ajax_error', parse_errors: [`fetchBuildingAjax falhou: ${ajaxResult.error}`] });
      continue;
    }

    const { html, found, error: payloadError } = parseChangeViewPayload(ajaxResult.data);

    if (!found || !html) {
      results.push({ ...base, upgrade_costs: null, upgrade_time_text: null, upgrade_time_seconds: null,
        next_level_effect_raw: null, next_level_effect_parsed: null, effect_type: 'unknown',
        prerequisites: [], queue_active: pos.isBusy,
        data_source: 'ajax_no_html', parse_errors: [payloadError ?? 'changeView não encontrado'] });
      continue;
    }

    let parsed;
    try {
      parsed = await parseBuildingHTML(page, html, buildingType);
    } catch (e) {
      parsed = { upgrade_costs: null, upgrade_time_text: null, upgrade_time_seconds: null,
        next_level_effect: null, queue_active: false, prerequisites: [],
        parse_errors: [`parseBuildingHTML exceção: ${e.message}`] };
    }

    const allErrors = [...(parsed.parse_errors ?? []), ...parseErrors];

    results.push({
      ...base,
      upgrade_costs: parsed.upgrade_costs ?? null,
      upgrade_time_text: parsed.upgrade_time_text ?? null,
      upgrade_time_seconds: parsed.upgrade_time_seconds ?? null,
      next_level_effect_raw: parsed.next_level_effect_raw ?? null,
      next_level_effect_parsed: parsed.next_level_effect_parsed ?? null,
      effect_type: parsed.effect_type ?? 'unknown',
      prerequisites: parsed.prerequisites ?? [],
      queue_active: parsed.queue_active ?? pos.isBusy,
      data_source: 'ajax',
      parse_errors: allErrors,
      _debug: {
        upgrade_time_selector: parsed.upgrade_time_selector ?? null,
        next_level_effect_selector: parsed.next_level_effect_selector ?? null,
        raw_html_snippet: parsed.raw_html_snippet ?? null,
      },
    });
  }

  return results;
}

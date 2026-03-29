/**
 * scraper_explore.mjs
 * Scraper de exploração — mapeia seletores, dados e estratégias por view.
 * Gera scraper_report.json com cobertura completa.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { scrapeBuildingsFromCity } from './modules/BuildingScraper.mjs';

// ── Configuração ─────────────────────────────────────────────────────────────

const SERVER_BASE = 'https://s73-br.ikariam.gameforge.com';

const VIEWS = [
  'city',
  'townHall',
  'island',
  'academy',
  'warehouse',
  'tavern',
  'museum',
  'palace',
  'palaceColony',
  'port',
  'barracks',
  'shipyard',
];

const CITIES = [6580, 6581, 6582, 6583, 6584]; // IDs das cidades do analise.json

const REPORT = {
  session_url: null,
  cities: {},
  views: {},
  parsing_rules: {},
  overlay_fields: [],
  coverage: { confirmed: [], partial: [], missing: [], needs_validation: [] },
  errors: [],
};

mkdirSync('./scraper_dumps', { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function parseNumber(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\s/g, '');
  if (s.includes('M')) return Math.round(parseFloat(s.replace(',', '.').replace('M', '')) * 1_000_000);
  if (s.includes('K')) return Math.round(parseFloat(s.replace(',', '.').replace('K', '')) * 1_000);
  // separa campos compostos: "313 + 156" → { base: 313, bonus: 156 }
  if (s.includes('+')) {
    const parts = s.split('+').map(p => parseInt(p.replace(/\./g, '').replace(',', ''), 10));
    return { base: parts[0], bonus: parts[1], total: parts[0] + parts[1] };
  }
  const clean = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? raw : n;
}

function safeText(el) {
  return el?.textContent?.trim() || null;
}

async function waitForView(page, view, cityId, timeout = 15000) {
  const url = `${SERVER_BASE}/index.php?view=${view}&cityId=${cityId}`;
  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Tenta networkidle com timeout reduzido
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const elapsed = Date.now() - start;
    return { ok: true, elapsed, url: page.url() };
  } catch (e) {
    return { ok: false, error: e.message, elapsed: Date.now() - start };
  }
}

async function dumpHTML(page, name) {
  try {
    const html = await page.content();
    writeFileSync(`./scraper_dumps/${name}.html`, html);
  } catch {}
}

async function extractField(page, selector, attr = null) {
  try {
    const el = await page.$(selector);
    if (!el) return { found: false };
    const text = await el.textContent();
    const titleAttr = await el.getAttribute('title');
    const result = { found: true, text: text?.trim(), title: titleAttr };
    if (attr) result[attr] = await el.getAttribute(attr);
    return result;
  } catch (e) {
    return { found: false, error: e.message };
  }
}

async function detectOverlay(page) {
  // Detecta extensões/scripts que alteram o DOM
  return await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
    const modified = [];
    // Procura por elementos com classes não-nativas do Ikariam
    document.querySelectorAll('[class]').forEach(el => {
      const cls = el.className;
      if (typeof cls === 'string' && (cls.includes('ikb-') || cls.includes('ext-') || cls.includes('overlay'))) {
        modified.push({ class: cls, text: el.textContent?.trim().slice(0, 50) });
      }
    });
    return { external_scripts: scripts.filter(s => !s.includes('ikariam')), modified_elements: modified.slice(0, 20) };
  });
}

// ── Scraper por view ──────────────────────────────────────────────────────────

async function scrapeCity(page, cityId) {
  log('city', `Iniciando cityId=${cityId}`);
  const nav = await waitForView(page, 'city', cityId);
  if (!nav.ok) return { error: nav.error };

  await dumpHTML(page, `city_${cityId}`);

  const data = await page.evaluate(() => {
    const safe = (sel, attr) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return attr ? el.getAttribute(attr) : el.textContent?.trim();
    };
    const safeAll = (sel) => [...document.querySelectorAll(sel)].map(el => el.textContent?.trim());

    return {
      // Recursos atuais (seletores confirmados)
      wood:        safe('#js_GlobalMenu_wood'),
      wine:        safe('#js_GlobalMenu_wine'),
      marble:      safe('#js_GlobalMenu_marble'),
      crystal:     safe('#js_GlobalMenu_crystal'),
      sulfur:      safe('#js_GlobalMenu_sulfur'),

      // Ouro
      gold:        safe('#js_GlobalMenu_gold'),
      gold_total:  safe('#js_GlobalMenu_gold_Total'),
      income:      safe('#js_GlobalMenu_income'),
      upkeep:      safe('#js_GlobalMenu_upkeep'),
      scientists_upkeep: safe('#js_GlobalMenu_scientistsUpkeep'),
      gold_net:    safe('#js_GlobalMenu_gold_Calculation'),

      // Capacidade armazém
      wood_cap:    safe('#js_GlobalMenu_max_wood'),
      wine_cap:    safe('#js_GlobalMenu_max_wine'),
      marble_cap:  safe('#js_GlobalMenu_max_marble'),
      sulfur_cap:  safe('#js_GlobalMenu_max_sulfur'),

      // Produção (confirmado apenas cristal)
      crystal_prod: safe('#js_GlobalMenu_production_crystal'),

      // cityId da URL
      city_id: new URLSearchParams(window.location.search).get('cityId'),

      // Slots vazios (buildingGround)
      empty_slots: [...document.querySelectorAll('[class*="buildingGround"]')].length,

      // Nome da cidade
      city_name: safe('#js_oldCityName'),

      // Extrai position[] do script inline (updateBackgroundData)
      // O script é removido do DOM após execução — lemos via outerHTML dos scripts ainda presentes
      position_json: (() => {
        const scripts = [...document.querySelectorAll('script:not([src])')];
        for (const s of scripts) {
          const t = s.textContent || '';
          const i = t.indexOf('"updateBackgroundData"');
          if (i === -1) continue;
          // Localiza o início do objeto JSON após a chave
          const start = t.indexOf('{', i);
          if (start === -1) continue;
          // Balanço de chaves para extrair o objeto completo
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
      })(),
    };
  });

  log('city', `✓ cityId=${cityId} — madeira=${data.wood}, ouro=${data.gold_total}, edifícios=${data.position_json?.length ?? 'N/A'}`);
  return { nav, data };
}

async function scrapeTownHall(page, cityId) {
  log('townHall', `cityId=${cityId}`);
  const nav = await waitForView(page, 'townHall', cityId);
  if (!nav.ok) return { error: nav.error };
  await dumpHTML(page, `townHall_${cityId}`);

  const data = await page.evaluate(() => {
    const safe = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    return {
      population:    safe('#value_population') || safe('.population'),
      citizens:      safe('#value_citizens'),
      growth:        safe('#growthRate') || safe('[id*="growth"]'),
      satisfaction:  safe('#happinessValue') || safe('[class*="satisfaction"]'),
      mood:          safe('[id*="mood"]') || safe('[class*="mood"]'),
      corruption:    safe('[id*="corruption"]') || safe('[class*="corruption"]'),
      city_gold:     safe('[id*="cityGold"]') || safe('[class*="gold"]'),
      workforce:     safe('[id*="workforce"]') || safe('[class*="workforce"]'),
      action_points: safe('[id*="actionPoints"]') || safe('[class*="actionPoint"]'),
      // Tabela de satisfação
      satisfaction_details: [...document.querySelectorAll('.happinessInfo tr, [class*="satisfaction"] tr')].map(tr => tr.textContent?.trim()),
    };
  });

  log('townHall', `✓ população=${data.population}, satisfação=${data.satisfaction}`);
  return { nav, data };
}

async function scrapeIsland(page, cityId) {
  log('island', `cityId=${cityId}`);
  const nav = await waitForView(page, 'island', cityId);
  if (!nav.ok) return { error: nav.error };
  await dumpHTML(page, `island_${cityId}`);

  const data = await page.evaluate(() => {
    const safe = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const safeAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || null;
    return {
      coords:       safe('[id*="coords"]') || safe('.coordinates') || safe('[class*="coords"]'),
      resource:     safe('[id*="islandResource"]') || safe('[class*="tradegood"]'),
      wonder:       safe('[id*="wonder"]') || safe('[class*="wonder"]'),
      sawmill:      safe('[id*="sawmill"]') || safe('[class*="forest"]'),
      special_mine: safe('[id*="mine"]') || safe('[class*="mine"]'),
      city_position: safeAttr('[class*="ownCity"]', 'data-position') || null,
      // Cidades na ilha
      island_cities: [...document.querySelectorAll('[class*="citySlot"], [class*="city_slot"]')].map(el => ({
        class: el.className,
        title: el.getAttribute('title'),
        text: el.textContent?.trim().slice(0, 30),
      })),
    };
  });

  log('island', `✓ coords=${data.coords}, recurso=${data.resource}`);
  return { nav, data };
}


// ── Main ──────────────────────────────────────────────────────────────────────

const context = await chromium.launchPersistentContext('./browser_profile', {
  headless: false,
  slowMo: 30,
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

await context.route('**', (route) => {
  const url = route.request().url();
  if (url.includes('static.crm.gfsrv.net') || url.includes('2mdn.net')) route.abort();
  else route.continue();
});

const START_URL = 'https://s73-br.ikariam.gameforge.com/?view=city&cityId=6583';

// Verifica se já existe aba com o jogo aberto
let gamePage = context.pages().find(p => p.url().includes('s73-br.ikariam.gameforge.com') && !p.url().includes('lobby'));

if (!gamePage) {
  // Abre lobby e faz login / clica no servidor
  gamePage = context.pages()[0] || await context.newPage();
  await gamePage.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await gamePage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  if (gamePage.url().includes('lobby') || gamePage.url().includes('login')) {
    log('init', 'Sessão expirada — faça login no browser...');
    await gamePage.waitForSelector('button.button-default:has-text("Jogou pela última vez")', { timeout: 180000 });
    log('init', 'Botão do servidor encontrado, clicando...');
    await gamePage.click('button.button-default:has-text("Jogou pela última vez")');
    // O jogo pode abrir em nova aba
    const [newPage] = await Promise.all([
      context.waitForEvent('page').catch(() => null),
      gamePage.waitForURL(
        url => url.toString().includes('s73-br.ikariam.gameforge.com') && !url.toString().includes('lobby'),
        { timeout: 60000 }
      ).catch(() => {}),
    ]);
    if (newPage && newPage.url().includes('s73-br')) {
      gamePage = newPage;
    } else {
      gamePage = context.pages().find(p => p.url().includes('s73-br.ikariam.gameforge.com')) || gamePage;
    }
    log('init', 'Entrou no servidor, continuando...');
  }
} else {
  log('init', 'Aba do jogo já aberta, reutilizando...');
}

REPORT.session_url = gamePage.url();
log('init', `Sessão ativa: ${REPORT.session_url}`);

log('init', `Servidor: ${SERVER_BASE}`);

// ── Exploração por cidade e view ──────────────────────────────────────────────

for (const cityId of CITIES) {
  log('explore', `=== Cidade ${cityId} ===`);
  REPORT.cities[cityId] = {};

  // city
  REPORT.cities[cityId].city = await scrapeCity(gamePage, cityId);
  await gamePage.waitForTimeout(800);

  // townHall
  REPORT.cities[cityId].townHall = await scrapeTownHall(gamePage, cityId);
  await gamePage.waitForTimeout(800);

  // island (só primeira cidade para não repetir)
  if (cityId === CITIES[0]) {
    REPORT.cities[cityId].island = await scrapeIsland(gamePage, cityId);
    await gamePage.waitForTimeout(800);
  }

  // Edifícios via AJAX — usa position_json já extraído durante scrapeCity
  const positionJson = REPORT.cities[cityId].city?.data?.position_json;
  log('buildings', `Iniciando scraping de edifícios via AJAX para cityId=${cityId} (${positionJson?.length ?? 0} posições)`);
  REPORT.cities[cityId].buildings = await scrapeBuildingsFromCity(gamePage, SERVER_BASE, cityId, positionJson);
  log('buildings', `✓ ${REPORT.cities[cityId].buildings.length} edifícios coletados`);

  // Detecta overlays — navega de volta para city
  await waitForView(gamePage, 'city', cityId);

  // Detecta overlays na city (já estamos na city view)
  REPORT.cities[cityId].overlay_check = await detectOverlay(gamePage);

  log('explore', `=== Cidade ${cityId} concluída ===`);
}

// ── Regras de parsing detectadas ─────────────────────────────────────────────

REPORT.parsing_rules = {
  thousand_separator: 'ponto (1.928 → 1928)',
  decimal_separator: 'vírgula (0,18 → 0.18)',
  millions: '2,93M → 2930000',
  composite_field: '313 + 156 → { base: 313, bonus: 156, total: 469 }',
  negative: '-3.052 → -3052',
  overlay_contamination: 'campos com M+N indicam overlay somando ao valor nativo',
};

// ── Cobertura ─────────────────────────────────────────────────────────────────

function classifyField(val) {
  if (!val || val.error) return 'missing';
  if (val === null) return 'missing';
  return 'confirmed';
}

const firstCity = REPORT.cities[CITIES[0]];
if (firstCity) {
  const cityData = firstCity.city?.data || {};
  ['wood', 'wine', 'marble', 'glass', 'sulfur'].forEach(f => {
    if (cityData[f]) REPORT.coverage.confirmed.push(`city.${f}`);
    else REPORT.coverage.missing.push(`city.${f}`);
  });
  if (cityData.gold) REPORT.coverage.confirmed.push('city.gold');
  else REPORT.coverage.partial.push('city.gold — seletor alternativo');

  const thData = firstCity.townHall?.data || {};
  ['population', 'satisfaction', 'growth'].forEach(f => {
    if (thData[f]) REPORT.coverage.confirmed.push(`townHall.${f}`);
    else REPORT.coverage.missing.push(`townHall.${f}`);
  });
}

REPORT.coverage.needs_validation = [
  'overlay vs game source em campos de ouro',
  'campos compostos com tooltip',
  'produção/h vs snapshot instantâneo',
  'island.city_position',
];

// ── Salva relatório ───────────────────────────────────────────────────────────

writeFileSync('./scraper_report.json', JSON.stringify(REPORT, null, 2));
log('done', '✓ scraper_report.json salvo');
log('done', `Confirmed: ${REPORT.coverage.confirmed.length} | Partial: ${REPORT.coverage.partial.length} | Missing: ${REPORT.coverage.missing.length}`);
log('done', `HTMLs salvos em ./scraper_dumps/`);

await context.close();

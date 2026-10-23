const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  carregarBaterias,
  dimensionarBaterias,
  selecionarBateria,
  montarLogSelecaoBateria
} = require('../services/baterias');

const CABECALHO = 'id,fabricante,modelo,tecnologia,tensao_v,capacidade_ah,capacidade_kwh,dod_pct,ciclos,preco_brl,data_consulta_tecnica,data_consulta_preco,fonte';
const LINHA_OK = '1,Fabricante,Modelo,LiFePO4,48,50,2.4,90,>=6000,5000,2026-10-23,2026-10-02,ficha técnica | varejista';

function escrever(linhas, cabecalho = CABECALHO) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bat-')), 'baterias.csv');
  fs.writeFileSync(arquivo, [cabecalho, ...linhas].join('\n'));
  return arquivo;
}

test('dataset: carrega modelos reais com campos obrigatórios, fontes e data', () => {
  const baterias = carregarBaterias();
  assert.ok(baterias.length >= 2);
  assert.deepStrictEqual(baterias.map((b) => b.modelo), ['B4850', 'US5000']);
  for (const b of baterias) {
    assert.ok(b.fabricante && b.modelo && b.tecnologia && b.fonte);
    assert.ok(b.capacidadeKwh > 0 && b.capacidadeAh > 0 && b.dod > 0 && b.dod <= 1 && b.tensaoV > 0 && b.precoBrl > 0);
    assert.ok(b.ciclos > 0 && b.ciclosCondicao && b.ciclosTexto);
    assert.match(b.dataConsulta, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('dataset: aceita linha válida e rejeita cabeçalho, tipos, faixas, preço, data e id duplicado', () => {
  const linhaOk = carregarBaterias(escrever([LINHA_OK]))[0];
  assert.strictEqual(linhaOk.dod, 0.9);
  assert.strictEqual(linhaOk.capacidadeAh, 50);
  assert.strictEqual(linhaOk.ciclosTexto, '>=6000');
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,abc,2.4,90,>=6000,5000,2026-10-23,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever([LINHA_OK], 'id,modelo')), /cabeçalho inválido/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,50,abc,90,>=6000,5000,2026-10-23,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,50,2.4,101,>=6000,5000,2026-10-23,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,50,2.4,90,>=6000,0,2026-10-23,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,50,2.4,90,>=6000,5000,2026-10-23,02/10/2026,fonte'])), /linha inválida/);
  const semCiclos = carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,48,50,2.4,90,,5000,2026-10-23,2026-10-02,fonte']))[0];
  assert.strictEqual(semCiclos.ciclos, null);
  assert.throws(() => carregarBaterias(escrever([LINHA_OK, LINHA_OK])), /id duplicado/);
  assert.throws(() => carregarBaterias(escrever([])), /vazio/);
});

test('PB11: seleciona bateria existente e rejeita id inválido ou inexistente', () => {
  const baterias = carregarBaterias();
  assert.strictEqual(selecionarBateria('1', baterias).bateria.id, 1);
  assert.match(selecionarBateria('abc', baterias).erro, /identificador/);
  assert.match(selecionarBateria(999, baterias).erro, /não encontrada/);
});

test('PB11: aplica DoD e eficiência, arredonda quantidade para cima e calcula capacidade/custo', () => {
  const bateria = carregarBaterias()[0];
  const r = dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 0.9 });
  assert.strictEqual(r.capacidadeNominalNecessariaKwh, 12.35);
  assert.strictEqual(r.capacidadeUtilUnitariaKwh, 2.16);
  assert.strictEqual(r.energiaUtilNecessariaKwh, 11.11);
  assert.strictEqual(r.quantidade, 6);
  assert.strictEqual(r.capacidadeInstaladaKwh, 14.4);
  assert.strictEqual(r.capacidadeUtilInstaladaKwh, 12.96);
  assert.strictEqual(r.custoBrl, 53848.68);
  const log = montarLogSelecaoBateria(r, 10, 0.9);
  assert.strictEqual(log.etapa, 'SELECAO_BATERIA');
  assert.strictEqual(log.resultado, 6);
  assert.strictEqual(log.formula, 'N_bat = teto(C_bat / C_unidade); C_bat = E_autonomia / (DoD × η_bat)');
  assert.strictEqual(log.unidade, 'baterias');
});

test('PB11: rejeita energia requerida e eficiência inválidas', () => {
  const bateria = carregarBaterias()[0];
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 0, eficiencia: 0.9 }).erro);
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 0 }).erro);
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 1.1 }).erro);
});

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

const CABECALHO = 'id,fabricante,modelo,tecnologia,capacidade_kwh,dod_pct,tensao_v,preco_brl,data_consulta,fonte';
const LINHA_OK = '1,Fabricante,Modelo,LiFePO4,2.4,90,48,5000,2026-10-02,ficha técnica | varejista';

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
    assert.ok(b.capacidadeKwh > 0 && b.dod > 0 && b.dod <= 1 && b.tensaoV > 0 && b.precoBrl > 0);
    assert.match(b.dataConsulta, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('dataset: aceita linha válida e rejeita cabeçalho, tipos, faixas, preço, data e id duplicado', () => {
  assert.strictEqual(carregarBaterias(escrever([LINHA_OK]))[0].dod, 0.9);
  assert.throws(() => carregarBaterias(escrever([LINHA_OK], 'id,modelo')), /cabeçalho inválido/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,abc,90,48,5000,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,2.4,101,48,5000,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,2.4,90,48,0,2026-10-02,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever(['1,Fabricante,Modelo,LiFePO4,2.4,90,48,5000,02/10/2026,fonte'])), /linha inválida/);
  assert.throws(() => carregarBaterias(escrever([LINHA_OK, LINHA_OK])), /id duplicado/);
  assert.throws(() => carregarBaterias(escrever([])), /vazio/);
});

test('PB15: seleciona bateria existente e rejeita id inválido ou inexistente', () => {
  const baterias = carregarBaterias();
  assert.strictEqual(selecionarBateria('1', baterias).bateria.id, 1);
  assert.match(selecionarBateria('abc', baterias).erro, /identificador/);
  assert.match(selecionarBateria(999, baterias).erro, /não encontrada/);
});

test('PB15: aplica DoD uma vez, arredonda quantidade para cima e calcula capacidade/custo', () => {
  const bateria = carregarBaterias()[0];
  const r = dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 0.9 });
  assert.strictEqual(r.capacidadeUtilUnitariaKwh, 2.16);
  assert.strictEqual(r.energiaUtilNecessariaKwh, 11.11);
  assert.strictEqual(r.quantidade, 6);
  assert.strictEqual(r.capacidadeInstaladaKwh, 14.4);
  assert.strictEqual(r.capacidadeUtilInstaladaKwh, 12.96);
  assert.strictEqual(r.custoBrl, 53848.68);
  const log = montarLogSelecaoBateria(r, 10, 0.9);
  assert.strictEqual(log.etapa, 'SELECAO_BATERIA');
  assert.strictEqual(log.resultado, 6);
  assert.strictEqual(log.unidade, 'baterias');
});

test('PB15: rejeita energia requerida e eficiência inválidas', () => {
  const bateria = carregarBaterias()[0];
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 0, eficiencia: 0.9 }).erro);
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 0 }).erro);
  assert.ok(dimensionarBaterias({ bateria, energiaAutonomiaKwh: 10, eficiencia: 1.1 }).erro);
});

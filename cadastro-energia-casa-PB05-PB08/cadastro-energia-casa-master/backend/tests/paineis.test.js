const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  COLUNAS,
  dividirLinhaCsv,
  carregarPaineis,
  listarPaineis,
  obterPainelPorId
} = require('../services/paineis');

const CABECALHO = COLUNAS.join(',');

function csvTemporario(linhas, cabecalho = CABECALHO) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paineis-'));
  const arquivo = path.join(dir, 'paineis.csv');
  fs.writeFileSync(arquivo, [cabecalho, ...linhas].join('\n'));
  return arquivo;
}

const LINHA_OK = '1,Fab,Modelo X,550,21.3,600,"Datasheet X, STC"';

test('dataset versionado: ≥3 módulos reais com todos os campos e fonte', () => {
  const paineis = listarPaineis();
  assert.ok(paineis.length >= 3);
  for (const p of paineis) {
    assert.ok(p.id > 0);
    assert.ok(p.fabricante && p.modelo);
    assert.ok(p.potenciaWp >= 100 && p.potenciaWp <= 800);
    assert.ok(p.eficienciaPct >= 10 && p.eficienciaPct <= 28);
    assert.ok(p.precoBrl > 0);
    assert.ok(p.fonte.length > 0, `${p.modelo} sem fonte`);
  }
});

test('dataset: o arquivo é o único lugar com módulos (sem módulo fixo no código)', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'services', 'paineis.js'), 'utf-8');
  for (const p of listarPaineis()) {
    assert.ok(!codigo.includes(p.modelo), `${p.modelo} não deveria estar no código`);
  }
});

test('obterPainelPorId: encontra por id (número ou texto) e devolve null se não existe', () => {
  assert.strictEqual(obterPainelPorId(1).id, 1);
  assert.strictEqual(obterPainelPorId('2').id, 2);
  assert.strictEqual(obterPainelPorId(999), null);
});

test('csv: campo entre aspas com vírgula não quebra colunas', () => {
  assert.deepStrictEqual(dividirLinhaCsv(LINHA_OK), ['1', 'Fab', 'Modelo X', '550', '21.3', '600', 'Datasheet X, STC']);
  const [p] = carregarPaineis(csvTemporario([LINHA_OK])).values();
  assert.strictEqual(p.fonte, 'Datasheet X, STC');
  assert.strictEqual(p.potenciaWp, 550);
});

test('validação: cabeçalho inválido, arquivo vazio e sem módulos', () => {
  assert.throws(() => carregarPaineis(csvTemporario([LINHA_OK], 'id,nome')), /cabeçalho inválido/);
  assert.throws(() => carregarPaineis(csvTemporario([])), /sem nenhum módulo/);
  const vazio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paineis-')), 'v.csv');
  fs.writeFileSync(vazio, '');
  assert.throws(() => carregarPaineis(vazio), /vazio/);
});

test('validação: campos obrigatórios, tipos e faixas', () => {
  const casos = [
    ['1,,Modelo,550,21.3,600,fonte', /fabricante/],
    ['1,Fab,,550,21.3,600,fonte', /modelo/],
    ['1,Fab,M,550,21.3,600,', /fonte/],
    ['x,Fab,M,550,21.3,600,fonte', /id/],
    ['1,Fab,M,abc,21.3,600,fonte', /potencia_wp/],
    ['1,Fab,M,5,21.3,600,fonte', /potencia_wp/],
    ['1,Fab,M,550,95,600,fonte', /eficiencia_pct/],
    ['1,Fab,M,550,21.3,0,fonte', /preco_brl/],
    ['1,Fab,M,550,21.3,-5,fonte', /preco_brl/],
    ['1,Fab,M,550,21.3,600', /colunas/]
  ];
  for (const [linha, regex] of casos) {
    assert.throws(() => carregarPaineis(csvTemporario([linha])), regex, linha);
  }
});

test('validação: id duplicado e indica a linha com erro', () => {
  assert.throws(() => carregarPaineis(csvTemporario([LINHA_OK, LINHA_OK])), /duplicado/);
  assert.throws(
    () => carregarPaineis(csvTemporario([LINHA_OK, '2,Fab,M,550,21.3,abc,fonte'])),
    /linha 3/
  );
});

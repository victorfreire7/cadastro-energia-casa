const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UFS } = require('../utils/ufs');
const {
  HSP_MIN,
  HSP_MAX,
  FONTE_MANUAL,
  validarHsp,
  carregarTabelaHsp,
  obterHspPorUf,
  resolverHsp
} = require('../services/hsp');

const tabela = carregarTabelaHsp();

test('dataset: cobre as 27 UFs, todas na faixa plausível e com fonte', () => {
  assert.strictEqual(tabela.size, UFS.length);
  for (const uf of UFS) {
    const r = tabela.get(uf);
    assert.ok(r.hsp >= HSP_MIN && r.hsp <= HSP_MAX, `${uf} fora da faixa`);
    assert.ok(r.fonte.length > 0, `${uf} sem fonte`);
    assert.ok(r.regiao.length > 0, `${uf} sem região`);
  }
});

test('dataset: rejeita HSP fora da faixa, UF duplicada e UF faltando', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsp-'));
  const escrever = (nome, linhas) => {
    const f = path.join(dir, nome);
    fs.writeFileSync(f, ['uf,regiao,hsp_kwh_m2_dia,fonte', ...linhas].join('\n'));
    return f;
  };
  assert.throws(() => carregarTabelaHsp(escrever('a.csv', ['SP,Sudeste,9.9,x'])), /linha inválida/);
  assert.throws(() => carregarTabelaHsp(escrever('b.csv', ['SP,Sudeste,5,x', 'SP,Sudeste,5,x'])), /duplicada/);
  assert.throws(() => carregarTabelaHsp(escrever('c.csv', ['SP,Sudeste,5,x'])), /sem as UFs/);
});

test('HSP: associado à localidade (UF) e case-insensitive', () => {
  assert.strictEqual(obterHspPorUf('sp', tabela).uf, 'SP');
  assert.strictEqual(obterHspPorUf('ZZ', tabela), null);
});

test('HSP: validação de faixa 3 a 6,5', () => {
  assert.strictEqual(validarHsp(3).valor, 3);
  assert.strictEqual(validarHsp('6,5').valor, 6.5);
  for (const v of [2.99, 6.51, 0, -4, 'abc']) assert.ok(validarHsp(v).erro, `deveria rejeitar ${v}`);
});

test('HSP: usa tabela e registra a fonte', () => {
  const r = resolverHsp({ uf: 'SP', tabela });
  assert.strictEqual(r.origem, 'tabela');
  assert.strictEqual(r.hsp, tabela.get('SP').hsp);
  assert.ok(r.fonte.includes('Atlas'));
});

test('HSP: sobrescrita manual tem prioridade e registra origem manual', () => {
  const r = resolverHsp({ uf: 'SP', hspManual: 4.8, tabela });
  assert.deepStrictEqual([r.hsp, r.origem, r.fonte], [4.8, 'manual', FONTE_MANUAL]);
});

test('HSP: manual inválido não cai na tabela; UF sem dado exige manual', () => {
  assert.ok(resolverHsp({ uf: 'SP', hspManual: 9, tabela }).erro);
  assert.ok(resolverHsp({ uf: 'ZZ', tabela }).erro);
  assert.strictEqual(resolverHsp({ uf: 'ZZ', hspManual: 5, tabela }).origem, 'manual');
});

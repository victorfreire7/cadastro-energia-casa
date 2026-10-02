const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  carregarInversores,
  avaliarCompatibilidade,
  selecionarInversoresCompativeis,
  escolherInversor
} = require('../services/inversores');

const inversores = carregarInversores();
const [growatt3, growatt5, fronius3] = inversores;

const CABECALHO =
  'id,fabricante,modelo,potencia_w,potencia_max_pv_w,tensao_max_v,mppt_min_v,mppt_max_v,num_mppt,preco_brl,data_consulta,fonte';
const LINHA_OK = '1,X,Y,3000,4200,500,60,500,2,1000.00,2026-10-02,fonte teste';

function escrever(linhas, cabecalho = CABECALHO) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-')), 'inversores.csv');
  fs.writeFileSync(arquivo, [cabecalho, ...linhas].join('\n'));
  return arquivo;
}

// ---------- PB09 — dataset ----------

test('dataset: pelo menos 3 inversores com todos os campos, fonte e data', () => {
  assert.ok(inversores.length >= 3);
  const ids = new Set(inversores.map((i) => i.id));
  assert.strictEqual(ids.size, inversores.length);
  for (const i of inversores) {
    assert.ok(i.fabricante && i.modelo && i.fonte.length > 0, `inversor ${i.id} incompleto`);
    assert.ok(i.potenciaW > 0 && i.precoBrl > 0 && i.numMppt >= 1);
    assert.ok(i.mpptMinV < i.mpptMaxV && i.mpptMaxV <= i.tensaoMaxV);
  }
});

test('dataset: aceita linha válida', () => {
  assert.strictEqual(carregarInversores(escrever([LINHA_OK]))[0].potenciaW, 3000);
});

test('dataset: rejeita cabeçalho errado, campo ausente, tipo inválido e id duplicado', () => {
  assert.throws(() => carregarInversores(escrever([LINHA_OK], 'id,modelo')), /cabeçalho inválido/);
  assert.throws(() => carregarInversores(escrever(['1,X,Y,3000,4200,500,60,500,2,1000.00,2026-10-02'])), /linha inválida/);
  assert.throws(() => carregarInversores(escrever(['1,X,Y,abc,4200,500,60,500,2,1000.00,2026-10-02,f'])), /linha inválida/);
  assert.throws(() => carregarInversores(escrever(['1,X,Y,3000,4200,500,60,500,2,0,2026-10-02,f'])), /linha inválida/);
  assert.throws(() => carregarInversores(escrever(['1,X,Y,3000,4200,500,60,500,2,1000.00,02/10/2026,f'])), /linha inválida/);
  assert.throws(() => carregarInversores(escrever(['1,X,Y,3000,4200,500,500,60,2,1000.00,2026-10-02,f'])), /linha inválida/);
  assert.throws(() => carregarInversores(escrever([LINHA_OK, LINHA_OK])), /id duplicado/);
  assert.throws(() => carregarInversores(escrever([])), /vazio/);
});

// ---------- PB10 — compatibilidade ----------

const ENTRADA = { potenciaInstaladaKwp: 3.5, tensaoStringVocV: 400, tensaoStringMppV: 300 };

test('compatibilidade: filtra por potência mínima/máxima e tensão, não por preço', () => {
  const r = selecionarInversoresCompativeis(ENTRADA, inversores);
  assert.deepStrictEqual(r.compativeis.map((i) => i.id), [growatt3.id, fronius3.id]);
  // o de 5 kW é descartado por potência mínima, mesmo sendo mais barato que o Fronius
  assert.strictEqual(r.rejeitados[0].inversor.id, growatt5.id);
  assert.match(r.rejeitados[0].motivos[0], /abaixo do mínimo/);
});

test('compatibilidade: potência acima do máximo suportado é rejeitada', () => {
  const r = avaliarCompatibilidade(growatt3, { ...ENTRADA, potenciaInstaladaKwp: 4.5 });
  assert.strictEqual(r.compativel, false);
  assert.match(r.motivos[0], /acima do máximo/);
});

test('compatibilidade: tensão Voc acima do máximo e MPP fora da faixa', () => {
  const alta = selecionarInversoresCompativeis({ ...ENTRADA, tensaoStringVocV: 600 }, inversores);
  assert.deepStrictEqual(alta.compativeis.map((i) => i.id), [fronius3.id]);

  const baixa = selecionarInversoresCompativeis({ ...ENTRADA, tensaoStringMppV: 100 }, inversores);
  assert.deepStrictEqual(baixa.compativeis.map((i) => i.id), [growatt3.id]);
});

test('compatibilidade: nenhum compatível devolve erro e os motivos', () => {
  const r = selecionarInversoresCompativeis({ ...ENTRADA, potenciaInstaladaKwp: 20 }, inversores);
  assert.match(r.erro, /nenhum inversor compatível/);
  assert.strictEqual(r.rejeitados.length, inversores.length);
});

test('compatibilidade: entradas inválidas são rejeitadas', () => {
  for (const campo of ['potenciaInstaladaKwp', 'tensaoStringVocV', 'tensaoStringMppV']) {
    for (const valor of [0, -1, 'abc', undefined]) {
      assert.ok(selecionarInversoresCompativeis({ ...ENTRADA, [campo]: valor }, inversores).erro, `${campo}=${valor}`);
    }
  }
});

test('escolha manual: aceita compatível; bloqueia incompatível e inexistente', () => {
  assert.strictEqual(escolherInversor(growatt3.id, ENTRADA, inversores).inversor.id, growatt3.id);
  assert.match(escolherInversor(growatt5.id, ENTRADA, inversores).erro, /incompatível/);
  assert.match(escolherInversor(999, ENTRADA, inversores).erro, /não encontrado/);
});

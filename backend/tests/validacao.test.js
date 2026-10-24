// PB18 — validação dos dados (mensagens compreensíveis)
const test = require('node:test');
const assert = require('node:assert');
const { lerNumero, dividirSeguro, validarEntradaProjeto, mensagemIncompatibilidade } = require('../services/validacao');
const { calcularProjeto, preDimensionar } = require('../services/projeto');

const corpoValido = (extra = {}) => ({
  hsp: 4.5, hspFonte: 'Atlas Brasileiro de Energia Solar', pr: 0.75, prJustificativa: 'perdas típicas de sistemas residenciais',
  painelId: 3, inversorId: 2, tarifaReaisKwh: 0.95, tarifaFonte: 'fatura da distribuidora', comBaterias: false,
  ...extra
});
const residencia = { endereco: 'Rua A, 1', cidade: 'São Paulo', uf: 'SP', potenciaInstaladaKw: 5.2 };
const consumo = { kwhMes: 450, origem: 'estimado' };
const rodar = (extra) => calcularProjeto({ residencia, consumo, corpo: corpoValido(extra) });

test('PB18: aceita entrada válida e normaliza números com vírgula', () => {
  const r = validarEntradaProjeto(corpoValido({ hsp: '4,5', pr: '0,75' }));
  assert.strictEqual(r.erros, undefined);
  assert.strictEqual(r.entrada.hsp, 4.5);
  assert.strictEqual(r.entrada.pr, 0.75);
  assert.strictEqual(r.entrada.percentualAtendimento, 100);
});

test('PB18: consumo negativo, HSP ≤ 0 e PR inválido geram mensagens claras', () => {
  const neg = validarEntradaProjeto(corpoValido({ consumoKwhMes: -10 }));
  assert.match(neg.erros.join(' '), /consumo mensal.*não pode ser negativo/i);
  const hsp = validarEntradaProjeto(corpoValido({ hsp: 0 }));
  assert.match(hsp.erros.join(' '), /HSP.*maior que zero/i);
  const hspNeg = validarEntradaProjeto(corpoValido({ hsp: -3 }));
  assert.match(hspNeg.erros.join(' '), /HSP.*negativo/i);
  for (const pr of [0, -0.5, 1.2, 'abc']) {
    assert.ok(validarEntradaProjeto(corpoValido({ pr })).erros.length > 0, `PR ${pr}`);
  }
  assert.match(validarEntradaProjeto(corpoValido({ pr: 1.2 })).erros.join(' '), /entre 0 e 1/);
});

test('PB18: campos obrigatórios ausentes são todos listados de uma vez', () => {
  const r = validarEntradaProjeto({});
  const texto = r.erros.join(' | ');
  for (const trecho of [/HSP/, /fonte da HSP/, /PR/, /Justifique/, /módulo/, /inversor/, /tarifa/, /fonte da tarifa/]) {
    assert.match(texto, trecho);
  }
  assert.ok(validarEntradaProjeto(null).erros.length > 0);
});

test('PB18: quantidades e valores negativos / não inteiros são rejeitados', () => {
  assert.ok(validarEntradaProjeto(corpoValido({ painelId: -1 })).erros.length > 0);
  assert.ok(validarEntradaProjeto(corpoValido({ painelId: 1.5 })).erros.length > 0);
  assert.match(validarEntradaProjeto(corpoValido({ custoComplementarBrl: -100 })).erros.join(' '), /negativo/);
  assert.match(validarEntradaProjeto(corpoValido({ percentualAtendimento: 0 })).erros.join(' '), /maior que zero/);
  assert.match(validarEntradaProjeto(corpoValido({ percentualAtendimento: 150 })).erros.join(' '), /no máximo 100/);
});

test('PB18: com baterias exige bateria e autonomia válidas (1 a 72 h)', () => {
  const sem = validarEntradaProjeto(corpoValido({ comBaterias: true }));
  assert.match(sem.erros.join(' '), /bateria/);
  assert.match(sem.erros.join(' '), /autonomia/);
  assert.match(validarEntradaProjeto(corpoValido({ comBaterias: true, bateriaId: 1, autonomiaHoras: 100 })).erros.join(' '), /no máximo 72/);
  assert.match(validarEntradaProjeto(corpoValido({ comBaterias: 'sim' })).erros.join(' '), /com ou sem baterias/);
});

test('PB18: divisão por zero nunca devolve Infinity nem NaN', () => {
  assert.strictEqual(dividirSeguro(10, 0), null);
  assert.strictEqual(dividirSeguro(NaN, 2), null);
  assert.strictEqual(dividirSeguro(10, 4), 2.5);
  assert.strictEqual(lerNumero('0', 'a HSP', { maiorQueZero: true }).erro, 'A HSP deve ser maior que zero.');
});

test('PB18: equipamento incompatível devolve mensagem explicando o motivo', () => {
  // inversor 1 (Growatt 3 kW) não comporta 4,95 kWp
  const r = rodar({ inversorId: 1 });
  assert.match(r.erros[0], /não é compatível com este sistema/);
  assert.match(r.erros[0], /acima do máximo/);
  assert.match(mensagemIncompatibilidade({ fabricante: 'X', modelo: 'Y' }, ['motivo A', 'motivo B']), /X Y.*motivo A; motivo B/);
});

test('PB18: inversor sem suporte a bateria e bateria incompatível são barrados no cenário com baterias', () => {
  const semSuporte = rodar({ comBaterias: true, bateriaId: 1, autonomiaHoras: 6, inversorComBateriasId: 2 });
  assert.match(semSuporte.erros[0], /não suporta baterias/);
  const incompativel = rodar({ comBaterias: true, bateriaId: 2, autonomiaHoras: 6, inversorComBateriasId: 4 });
  assert.match(incompativel.erros[0], /não é compatível com a bateria Pylontech US5000/);
});

test('PB18: equipamento inexistente nos datasets e residência incompleta', () => {
  assert.match(rodar({ painelId: 999 }).erros[0], /módulo escolhido não existe/);
  assert.match(rodar({ inversorId: 999 }).erros[0], /inversor escolhido não existe/);
  assert.match(rodar({ comBaterias: true, bateriaId: 999, autonomiaHoras: 6 }).erros[0], /bateria escolhida não existe/);
  const semEndereco = calcularProjeto({ residencia: { ...residencia, endereco: '' }, consumo, corpo: corpoValido() });
  assert.match(semEndereco.erros[0], /endereço, cidade e UF/);
  const semConsumo = calcularProjeto({ residencia, consumo: { kwhMes: null, origem: null }, corpo: corpoValido() });
  assert.match(semConsumo.erros[0], /ainda não tem consumo calculado/);
});

test('PB18: pré-dimensionamento marca cada inversor como compatível ou não, com motivos', () => {
  const pre = preDimensionar({ consumoKwhMes: 450, hsp: 4.5, pr: 0.75, painelId: 3 });
  assert.strictEqual(pre.erros, undefined);
  const porId = Object.fromEntries(pre.inversores.map((i) => [i.id, i]));
  assert.strictEqual(porId[2].compativel, true);
  assert.strictEqual(porId[1].compativel, false);
  assert.ok(porId[1].motivos.length > 0);
  assert.ok(preDimensionar({ consumoKwhMes: 450, hsp: 4.5, pr: 0.75, painelId: 999 }).erros);
});

// PB18 — validação dos dados do dimensionamento, com mensagens compreensíveis.
// Funções puras: não acessam banco nem rede. Coletam TODOS os problemas de uma vez
// (em vez de parar no primeiro), para o usuário corrigir tudo em uma só tentativa.

const { vazio, converterNumero } = require('./dimensionamento');

function texto(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

// Lê um número de um campo (aceita "85,5"). Devolve { valor } ou { erro } em português claro.
function cap(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function lerNumero(valor, rotulo, { obrigatorio = true, min = null, max = null, maiorQueZero = false, inteiro = false, unidade = '' } = {}) {
  const R = cap(rotulo);
  const sufixo = unidade ? ` ${unidade}` : '';
  if (vazio(valor)) {
    return obrigatorio ? { erro: `Informe ${rotulo}.` } : { vazio: true };
  }
  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) return { erro: `${R} deve ser um número (recebido: "${valor}").` };
  if (numero < 0) return { erro: `${R} não pode ser negativo.` };
  if (maiorQueZero && numero === 0) return { erro: `${R} deve ser maior que zero.` };
  if (inteiro && !Number.isInteger(numero)) return { erro: `${R} deve ser um número inteiro.` };
  if (min !== null && numero < min) return { erro: `${R} deve ser no mínimo ${min}${sufixo}.` };
  if (max !== null && numero > max) return { erro: `${R} deve ser no máximo ${max}${sufixo}.` };
  return { valor: numero };
}

// Divisão protegida: nunca devolve Infinity/NaN. `null` significa "não calculável".
function dividirSeguro(numerador, denominador) {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) return null;
  const r = numerador / denominador;
  return Number.isFinite(r) ? r : null;
}

// Valida os campos informados pelo usuário para um projeto de dimensionamento.
// Devolve { entrada } (já normalizada) ou { erros: [mensagens] }.
function validarEntradaProjeto(corpo) {
  const b = corpo && typeof corpo === 'object' ? corpo : {};
  const erros = [];
  const entrada = {};

  const coletar = (resultado, campo) => {
    if (resultado.erro) erros.push(resultado.erro);
    else if (!resultado.vazio) entrada[campo] = resultado.valor;
  };

  // Consumo: opcional (se vazio, o servidor usa o consumo já calculado do imóvel — PB01/PB02)
  coletar(lerNumero(b.consumoKwhMes, 'o consumo mensal (kWh/mês)', { obrigatorio: false, maiorQueZero: true }), 'consumoKwhMes');

  // Recurso solar (PB03)
  coletar(lerNumero(b.hsp, 'a HSP (horas de sol pico, h/dia)', { maiorQueZero: true }), 'hsp');
  if (!texto(b.hspFonte)) erros.push('Informe a fonte da HSP (por exemplo: Atlas Solar ou CRESESB).');
  else entrada.hspFonte = b.hspFonte.trim();

  const pr = lerNumero(b.pr, 'o PR (desempenho global do sistema)', { maiorQueZero: true });
  if (pr.erro) erros.push(pr.erro);
  else if (pr.valor > 1) erros.push('O PR deve estar entre 0 e 1 (por exemplo, 0,75 para 75%).');
  else entrada.pr = pr.valor;
  if (!texto(b.prJustificativa)) erros.push('Justifique o PR adotado.');
  else entrada.prJustificativa = b.prJustificativa.trim();

  const pct = lerNumero(b.percentualAtendimento ?? 100, 'o percentual do consumo a atender (%)', { maiorQueZero: true, min: 1, max: 100 });
  coletar(pct, 'percentualAtendimento');

  // Equipamentos (PB05/PB07)
  coletar(lerNumero(b.painelId, 'o módulo fotovoltaico', { maiorQueZero: true, inteiro: true }), 'painelId');
  coletar(lerNumero(b.inversorId, 'o inversor', { maiorQueZero: true, inteiro: true }), 'inversorId');

  // Economia (PB15)
  const tarifa = lerNumero(b.tarifaReaisKwh, 'a tarifa de energia (R$/kWh)', { maiorQueZero: true });
  if (tarifa.erro) erros.push(tarifa.erro);
  else if (tarifa.valor > 10) erros.push('A tarifa parece alta demais. Confira a unidade: R$ por kWh (não por MWh).');
  else entrada.tarifaReaisKwh = tarifa.valor;
  if (!texto(b.tarifaFonte)) erros.push('Informe a fonte da tarifa (por exemplo: fatura da distribuidora).');
  else entrada.tarifaFonte = b.tarifaFonte.trim();

  // Custos complementares (opcional)
  const comp = lerNumero(b.custoComplementarBrl, 'o custo complementar (R$)', { obrigatorio: false });
  if (comp.erro) erros.push(comp.erro);
  else if (!comp.vazio && comp.valor > 0) {
    entrada.custoComplementarBrl = comp.valor;
    if (!texto(b.custoComplementarDescricao)) erros.push('Descreva o custo complementar (instalação, estrutura, cabeamento etc.).');
    else entrada.custoComplementarDescricao = b.custoComplementarDescricao.trim();
  }

  // Baterias (PB10/PB11)
  const comBaterias = vazio(b.comBaterias) ? false : b.comBaterias;
  if (typeof comBaterias !== 'boolean') {
    erros.push('Escolha entre sistema com ou sem baterias.');
  } else {
    entrada.comBaterias = comBaterias;
    if (comBaterias) {
      coletar(lerNumero(b.bateriaId, 'a bateria', { maiorQueZero: true, inteiro: true }), 'bateriaId');
      coletar(lerNumero(b.autonomiaHoras, 'a autonomia desejada (horas)', { maiorQueZero: true, min: 1, max: 72, unidade: 'horas' }), 'autonomiaHoras');
      coletar(lerNumero(b.inversorComBateriasId ?? b.inversorId, 'o inversor híbrido', { maiorQueZero: true, inteiro: true }), 'inversorComBateriasId');
    }
  }

  return erros.length > 0 ? { erros } : { entrada };
}

// Traduz os motivos técnicos de incompatibilidade do inversor para texto de usuário.
function mensagemIncompatibilidade(inversor, motivos) {
  return `O inversor ${inversor.fabricante} ${inversor.modelo} não é compatível com este sistema: ${motivos.join('; ')}. Escolha outro inversor da lista de compatíveis.`;
}

module.exports = { lerNumero, dividirSeguro, validarEntradaProjeto, mensagemIncompatibilidade };

const fs = require('fs');
const path = require('path');
const { UFS } = require('../utils/ufs');
const { vazio, converterNumero } = require('./dimensionamento');

// PB03 — faixa plausível de HSP (h/dia ≡ kWh/m²/dia)
const HSP_MIN = 3;
const HSP_MAX = 6.5;

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'data', 'hsp_por_uf.csv');
const COLUNAS = ['uf', 'regiao', 'hsp_kwh_m2_dia', 'fonte'];

const FONTE_MANUAL = 'Informado manualmente pelo usuário';

function validarHsp(valor) {
  const numero = converterNumero(valor);
  if (Number.isNaN(numero)) {
    return { erro: 'hspKwhM2Dia deve ser um número' };
  }
  if (numero < HSP_MIN || numero > HSP_MAX) {
    return { erro: `hspKwhM2Dia deve estar entre ${HSP_MIN} e ${HSP_MAX} h/dia` };
  }
  return { valor: numero };
}

// Carrega e valida o dataset (nenhum valor de HSP fica fixo no código)
function carregarTabelaHsp(arquivo = ARQUIVO_PADRAO) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = linhas.shift().split(',').map((c) => c.trim());

  if (COLUNAS.some((c, i) => cabecalho[i] !== c)) {
    throw new Error(`dataset de HSP com cabeçalho inválido (esperado: ${COLUNAS.join(',')})`);
  }

  const tabela = new Map();
  for (const linha of linhas) {
    const [uf, regiao, hspTexto, ...resto] = linha.split(',');
    const fonte = resto.join(',').trim();
    const validacao = validarHsp(hspTexto);

    if (!UFS.includes(uf) || !regiao || !fonte || validacao.erro) {
      throw new Error(`dataset de HSP com linha inválida: "${linha}"`);
    }
    if (tabela.has(uf)) {
      throw new Error(`dataset de HSP com UF duplicada: ${uf}`);
    }
    tabela.set(uf, { uf, regiao: regiao.trim(), hsp: validacao.valor, fonte });
  }

  const faltando = UFS.filter((uf) => !tabela.has(uf));
  if (faltando.length > 0) {
    throw new Error(`dataset de HSP sem as UFs: ${faltando.join(', ')}`);
  }

  return tabela;
}

let cache = null;
function tabelaHsp() {
  if (!cache) cache = carregarTabelaHsp();
  return cache;
}

function obterHspPorUf(uf, tabela = tabelaHsp()) {
  return tabela.get(String(uf || '').toUpperCase()) || null;
}

// PB03 — HSP manual (se informado) tem prioridade; senão vem da tabela pela UF do imóvel
function resolverHsp({ uf, hspManual, tabela }) {
  if (!vazio(hspManual)) {
    const validacao = validarHsp(hspManual);
    if (validacao.erro) return { erro: validacao.erro };
    const registro = obterHspPorUf(uf, tabela);
    return {
      hsp: validacao.valor,
      origem: 'manual',
      fonte: FONTE_MANUAL,
      regiao: registro ? registro.regiao : null
    };
  }

  const registro = obterHspPorUf(uf, tabela);
  if (!registro) {
    return { erro: 'não há HSP cadastrado para esta localidade: informe o HSP manualmente' };
  }
  return { hsp: registro.hsp, origem: 'tabela', fonte: registro.fonte, regiao: registro.regiao };
}

module.exports = {
  HSP_MIN,
  HSP_MAX,
  FONTE_MANUAL,
  validarHsp,
  carregarTabelaHsp,
  tabelaHsp,
  obterHspPorUf,
  resolverHsp
};

'use strict';

const fs = require('fs');
const path = require('path');
const { converterNumero } = require('./dimensionamento');
const { calcularPotenciaFotovoltaica } = require('./calculoFotovoltaico');

const ARQUIVO = path.join(__dirname, '..', 'data', 'paineis.csv');
const CABECALHO = [
  'id', 'fabricante', 'modelo', 'potencia_wp', 'vmp_v', 'voc_v',
  'corrente_a', 'eficiencia_percentual', 'preco_brl', 'data_consulta', 'fonte'
];

function carregarPaineis(arquivo = ARQUIVO) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter((linha) => linha.trim() !== '');
  const cabecalho = (linhas.shift() || '').replace(/^\uFEFF/, '').split(',').map((valor) => valor.trim());

  if (cabecalho.length !== CABECALHO.length || CABECALHO.some((coluna, indice) => cabecalho[indice] !== coluna)) {
    throw new Error(`dataset de paineis com cabeçalho inválido (esperado: ${CABECALHO.join(',')})`);
  }

  const ids = new Set();
  const itens = linhas.map((linha) => {
    const [id, fabricante, modelo, potenciaWp, vmpV, vocV, correnteA, eficiencia, preco, dataConsulta, ...fonte] =
      linha.split(',').map((valor) => valor.trim());
    const numeros = [id, potenciaWp, vmpV, vocV, correnteA, eficiencia, preco].map(converterNumero);
    const painel = {
      id: numeros[0],
      fabricante,
      modelo,
      potenciaWp: numeros[1],
      vmpV: numeros[2],
      vocV: numeros[3],
      correnteA: numeros[4],
      eficienciaPercentual: numeros[5],
      precoBrl: numeros[6],
      dataConsulta,
      fonte: fonte.join(',').trim()
    };

    const potenciaEstimada = painel.vmpV * painel.correnteA;
    const divergenciaRelativa = Math.abs(painel.potenciaWp - potenciaEstimada) / painel.potenciaWp;
    if (
      !Number.isInteger(painel.id) ||
      numeros.slice(1).some((valor) => !Number.isFinite(valor) || valor <= 0) ||
      !fabricante ||
      !modelo ||
      !painel.fonte ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dataConsulta) ||
      painel.vmpV >= painel.vocV ||
      painel.eficienciaPercentual > 100 ||
      divergenciaRelativa > 0.05 ||
      ids.has(painel.id)
    ) {
      throw new Error(`dataset de paineis com linha inválida: "${linha}"`);
    }

    ids.add(painel.id);
    return painel;
  });

  if (itens.length === 0) throw new Error('dataset de paineis vazio');
  return itens;
}

let cache;
function paineisDisponiveis() {
  if (!cache) cache = carregarPaineis();
  return cache;
}

function dimensionarSistema({ energiaMensalKwh, hsp, eficiencia, painelId, diasReferencia = 30 }) {
  // Mantém a validação de diasReferencia por compatibilidade com cenários salvos
  // anteriormente; a fórmula PB04 usa, obrigatoriamente, a média E_mês / 30.
  if (!Number.isFinite(Number(diasReferencia)) || Number(diasReferencia) < 1 || Number(diasReferencia) > 31) {
    return { erro: 'diasReferencia deve estar entre 1 e 31' };
  }

  const calculo = calcularPotenciaFotovoltaica({
    consumoMensalKwh: energiaMensalKwh,
    hsp,
    pr: eficiencia
  });
  if (calculo.erro) return { erro: calculo.erro };

  const painel = paineisDisponiveis().find((item) => item.id === Number(painelId));
  if (!painel) return { erro: 'painel não encontrado' };

  // Quantidade sempre arredondada para cima, usando o resultado sem arredondar.
  const quantidade = Math.ceil((calculo.potenciaNecessariaKwp * 1000) / painel.potenciaWp);
  const potenciaInstaladaKwp = (quantidade * painel.potenciaWp) / 1000;
  const potenciaNecessariaArredondada = Number(calculo.potenciaNecessariaKwp.toFixed(3));

  return {
    painel,
    quantidade,
    energiaDiariaKwh: Number(calculo.energiaDiariaKwh.toFixed(2)),
    hsp: calculo.hsp,
    pr: calculo.pr,
    diasReferencia: Number(diasReferencia),
    potenciaNecessariaKwp: potenciaNecessariaArredondada,
    potenciaInstaladaKwp: Number(potenciaInstaladaKwp.toFixed(3)),
    custoPaineisBrl: Number((quantidade * painel.precoBrl).toFixed(2)),
    log: {
      etapa: 'POTENCIA_FV',
      formula: 'E_dia = E_mes / 30; P_FV = E_dia / (HSP × PR); N_mod = teto[(P_FV × 1000) / P_mod]',
      entradas: {
        energiaMensalKwh: Number(energiaMensalKwh),
        energiaDiariaKwh: calculo.energiaDiariaKwh,
        hsp: calculo.hsp,
        pr: calculo.pr,
        correnteModuloA: painel.correnteA,
        potenciaModuloWp: painel.potenciaWp,
        quantidadeModulos: quantidade,
        diasDaMediaMensal: 30
      },
      resultado: potenciaNecessariaArredondada,
      unidade: 'kWp'
    }
  };
}

module.exports = { carregarPaineis, paineisDisponiveis, dimensionarSistema };

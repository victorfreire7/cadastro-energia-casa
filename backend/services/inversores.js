const fs = require('fs');
const path = require('path');
const { converterNumero } = require('./dimensionamento');

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'data', 'inversores.csv');
const COLUNAS = [
  'id',
  'fabricante',
  'modelo',
  'potencia_w',
  'potencia_max_pv_w',
  'tensao_max_v',
  'mppt_min_v',
  'mppt_max_v',
  'num_mppt',
  'suporta_bateria',
  'baterias_compativeis',
  'preco_brl',
  'data_consulta',
  'fonte'
];
const COLUNAS_LEGADAS = ['id', 'fabricante', 'modelo', 'potencia_w', 'potencia_max_pv_w', 'tensao_max_v', 'mppt_min_v', 'mppt_max_v', 'num_mppt', 'preco_brl', 'data_consulta', 'fonte'];

// PB10 — potência instalada (CC) mínima aceita, em fração da potência nominal CA do inversor
const RAZAO_CC_CA_MIN = 0.8;

function positivo(texto) {
  const numero = converterNumero(texto);
  return Number.isNaN(numero) || numero <= 0 ? null : numero;
}

function lerLinha(linha) {
  const [id, fabricante, modelo, potenciaW, potenciaMaxPvW, tensaoMaxV, mpptMinV, mpptMaxV, numMppt, suportaBateria, bateriasCompativeis, precoBrl, dataConsulta, ...resto] =
    linha.split(',').map((c) => c.trim());

  const inversor = {
    id: positivo(id),
    fabricante,
    modelo,
    potenciaW: positivo(potenciaW),
    potenciaMaxPvW: positivo(potenciaMaxPvW),
    tensaoMaxV: positivo(tensaoMaxV),
    mpptMinV: positivo(mpptMinV),
    mpptMaxV: positivo(mpptMaxV),
    numMppt: positivo(numMppt),
    suportaBateria: suportaBateria === 'true',
    bateriasCompativeis: bateriasCompativeis ? bateriasCompativeis.split('|') : [],
    precoBrl: positivo(precoBrl),
    dataConsulta,
    fonte: resto.join(',').trim()
  };

  const numeros = [
    inversor.potenciaW,
    inversor.potenciaMaxPvW,
    inversor.tensaoMaxV,
    inversor.mpptMinV,
    inversor.mpptMaxV,
    inversor.precoBrl
  ];
  const valido =
    Number.isInteger(inversor.id) &&
    Number.isInteger(inversor.numMppt) &&
    ['true', 'false'].includes(suportaBateria) &&
    numeros.every((n) => n !== null) &&
    inversor.fabricante &&
    inversor.modelo &&
    inversor.fonte &&
    /^\d{4}-\d{2}-\d{2}$/.test(inversor.dataConsulta) &&
    inversor.potenciaMaxPvW >= inversor.potenciaW &&
    inversor.mpptMinV < inversor.mpptMaxV &&
    inversor.mpptMaxV <= inversor.tensaoMaxV;

  return valido ? inversor : null;
}

// PB09 — carrega e valida o dataset (nenhum inversor fica fixo no código)
function carregarInversores(arquivo = ARQUIVO_PADRAO) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = linhas.shift().replace(/^\uFEFF/, '').split(',').map((c) => c.trim());

  const legado = COLUNAS_LEGADAS.length === cabecalho.length && COLUNAS_LEGADAS.every((c, i) => cabecalho[i] === c);
  if (!legado && (cabecalho.length !== COLUNAS.length || COLUNAS.some((c, i) => cabecalho[i] !== c))) {
    throw new Error(`dataset de inversores com cabeçalho inválido (esperado: ${COLUNAS.join(',')})`);
  }

  const inversores = [];
  for (let linha of linhas) {
    if (legado) {
      const campos = linha.split(',');
      linha = [...campos.slice(0, 9), 'false', '', ...campos.slice(9)].join(',');
    }
    const inversor = lerLinha(linha);
    if (!inversor) {
      throw new Error(`dataset de inversores com linha inválida: "${linha}"`);
    }
    if (inversores.some((i) => i.id === inversor.id)) {
      throw new Error(`dataset de inversores com id duplicado: ${inversor.id}`);
    }
    inversores.push(inversor);
  }

  if (inversores.length === 0) {
    throw new Error('dataset de inversores vazio');
  }
  return inversores;
}

let cache = null;
function inversoresDisponiveis() {
  if (!cache) cache = carregarInversores();
  return cache;
}

// PB10 — as entradas vêm do cenário: potência instalada (kWp) e tensões da string de módulos (V)
function validarEntradaCompatibilidade({ potenciaInstaladaKwp, tensaoStringVocV, tensaoStringMppV }) {
  const campos = { potenciaInstaladaKwp, tensaoStringVocV, tensaoStringMppV };
  for (const [nome, valor] of Object.entries(campos)) {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      return `${nome} deve ser um número maior que zero`;
    }
  }
  return null;
}

// PB10 — potência mínima/máxima suportada e faixa de tensão de entrada (não olha o preço)
function avaliarCompatibilidade(inversor, { potenciaInstaladaKwp, tensaoStringVocV, tensaoStringMppV }) {
  const potenciaCcW = Number((potenciaInstaladaKwp * 1000).toFixed(2));
  const minimoW = inversor.potenciaW * RAZAO_CC_CA_MIN;
  const motivos = [];

  if (potenciaCcW < minimoW) {
    motivos.push(`potência instalada (${potenciaCcW} W) abaixo do mínimo do inversor (${minimoW} W)`);
  }
  if (potenciaCcW > inversor.potenciaMaxPvW) {
    motivos.push(`potência instalada (${potenciaCcW} W) acima do máximo do inversor (${inversor.potenciaMaxPvW} W)`);
  }
  if (potenciaCcW > inversor.potenciaW * 1.5) {
    motivos.push(`potência CC/CA (${(potenciaCcW / inversor.potenciaW).toFixed(2)}) acima do limite de 1,50 adotado para esta seleção`);
  }
  if (tensaoStringVocV > inversor.tensaoMaxV) {
    motivos.push(`tensão de circuito aberto da string (${tensaoStringVocV} V) acima do máximo do inversor (${inversor.tensaoMaxV} V)`);
  }
  if (tensaoStringMppV < inversor.mpptMinV || tensaoStringMppV > inversor.mpptMaxV) {
    motivos.push(
      `tensão MPP da string (${tensaoStringMppV} V) fora da faixa MPPT do inversor (${inversor.mpptMinV}–${inversor.mpptMaxV} V)`
    );
  }

  return { compativel: motivos.length === 0, motivos };
}

// PB10 — lista os inversores compatíveis; sem nenhum, devolve erro com os motivos de cada rejeição
function selecionarInversoresCompativeis(entrada, inversores = inversoresDisponiveis()) {
  const erroEntrada = validarEntradaCompatibilidade(entrada);
  if (erroEntrada) return { erro: erroEntrada };

  const compativeis = [];
  const rejeitados = [];
  for (const inversor of inversores) {
    const { compativel, motivos } = avaliarCompatibilidade(inversor, entrada);
    if (compativel) compativeis.push(inversor);
    else rejeitados.push({ inversor, motivos });
  }

  if (compativeis.length === 0) {
    return { erro: 'nenhum inversor compatível com a potência e a tensão do sistema', rejeitados };
  }
  return { compativeis, rejeitados };
}

// PB10 — escolha manual entre os compatíveis; incompatível ou inexistente é rejeitado
function escolherInversor(inversorId, entrada, inversores = inversoresDisponiveis()) {
  const erroEntrada = validarEntradaCompatibilidade(entrada);
  if (erroEntrada) return { erro: erroEntrada };

  const inversor = inversores.find((i) => i.id === Number(inversorId));
  if (!inversor) return { erro: 'inversor não encontrado' };

  const { compativel, motivos } = avaliarCompatibilidade(inversor, entrada);
  if (!compativel) {
    return { erro: `inversor incompatível: ${motivos.join('; ')}`, motivos };
  }
  return { inversor };
}

module.exports = {
  RAZAO_CC_CA_MIN,
  carregarInversores,
  inversoresDisponiveis,
  avaliarCompatibilidade,
  selecionarInversoresCompativeis,
  escolherInversor
};

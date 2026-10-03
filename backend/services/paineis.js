const fs = require('fs');
const path = require('path');
const { converterNumero } = require('./dimensionamento');

const ARQUIVO = path.join(__dirname, '..', 'data', 'paineis.csv');
const CABECALHO = ['id', 'fabricante', 'modelo', 'potencia_wp', 'vmp_v', 'voc_v', 'eficiencia_percentual', 'preco_brl', 'data_consulta', 'fonte'];

function carregarPaineis(arquivo = ARQUIVO) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean);
  const cabecalho = (linhas.shift() || '').replace(/^\uFEFF/, '').split(',').map((x) => x.trim());
  if (cabecalho.length !== CABECALHO.length || CABECALHO.some((x, i) => cabecalho[i] !== x)) {
    throw new Error(`dataset de paineis com cabeçalho inválido (esperado: ${CABECALHO.join(',')})`);
  }
  const ids = new Set();
  const itens = linhas.map((linha) => {
    const [id, fabricante, modelo, potenciaWp, vmpV, vocV, eficiencia, preco, dataConsulta, ...fonte] = linha.split(',').map((x) => x.trim());
    const n = [id, potenciaWp, vmpV, vocV, eficiencia, preco].map(converterNumero);
    const painel = { id: n[0], fabricante, modelo, potenciaWp: n[1], vmpV: n[2], vocV: n[3], eficienciaPercentual: n[4], precoBrl: n[5], dataConsulta, fonte: fonte.join(',').trim() };
    if (!Number.isInteger(painel.id) || n.slice(1).some((x) => !Number.isFinite(x) || x <= 0) || !fabricante || !modelo || !painel.fonte || !/^\d{4}-\d{2}-\d{2}$/.test(dataConsulta) || painel.vmpV >= painel.vocV || painel.eficienciaPercentual > 100 || ids.has(painel.id)) {
      throw new Error(`dataset de paineis com linha inválida: "${linha}"`);
    }
    ids.add(painel.id);
    return painel;
  });
  if (!itens.length) throw new Error('dataset de paineis vazio');
  return itens;
}

let cache;
function paineisDisponiveis() { if (!cache) cache = carregarPaineis(); return cache; }

function dimensionarSistema({ energiaMensalKwh, hsp, eficiencia, painelId, diasReferencia = 30 }) {
  if (![energiaMensalKwh, hsp, eficiencia].every((x) => Number.isFinite(Number(x)) && Number(x) > 0)) return { erro: 'energia mensal, HSP e eficiência devem ser maiores que zero' };
  if (Number(eficiencia) > 1) return { erro: 'eficienciaSistema deve estar entre 0 e 1' };
  if (!Number.isFinite(Number(diasReferencia)) || Number(diasReferencia) < 1 || Number(diasReferencia) > 31) return { erro: 'diasReferencia deve estar entre 1 e 31' };
  const painel = paineisDisponiveis().find((x) => x.id === Number(painelId));
  if (!painel) return { erro: 'painel não encontrado' };
  const potenciaNecessariaKwp = Number(energiaMensalKwh) / (Number(hsp) * Number(diasReferencia) * Number(eficiencia));
  const quantidade = Math.ceil(potenciaNecessariaKwp * 1000 / painel.potenciaWp);
  const potenciaInstaladaKwp = quantidade * painel.potenciaWp / 1000;
  return { painel, quantidade, diasReferencia: Number(diasReferencia), potenciaNecessariaKwp: Number(potenciaNecessariaKwp.toFixed(3)), potenciaInstaladaKwp: Number(potenciaInstaladaKwp.toFixed(3)), custoPaineisBrl: Number((quantidade * painel.precoBrl).toFixed(2)), log: { etapa: 'POTENCIA_FV', formula: 'P_FV = E_FV / (HSP × D × η); N = ceil(P_FV × 1000 / P_módulo)', entradas: { energiaMensalKwh: Number(energiaMensalKwh), hsp: Number(hsp), dias: Number(diasReferencia), eficienciaSistema: Number(eficiencia), potenciaModuloWp: painel.potenciaWp, quantidadeModulos: quantidade }, resultado: Number(potenciaNecessariaKwp.toFixed(3)), unidade: 'kWp' } };
}

module.exports = { carregarPaineis, paineisDisponiveis, dimensionarSistema };

const fs = require('fs');
const path = require('path');
const { converterNumero, arredondar } = require('./dimensionamento');

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'data', 'baterias.csv');
const COLUNAS = [
  'id',
  'fabricante',
  'modelo',
  'tecnologia',
  'capacidade_kwh',
  'dod_pct',
  'tensao_v',
  'preco_brl',
  'data_consulta',
  'fonte'
];

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

function lerLinha(linha) {
  const [idTexto, fabricante, modelo, tecnologia, capacidadeTexto, dodTexto, tensaoTexto, precoTexto, dataConsulta, ...resto] =
    linha.split(',').map((c) => c.trim());
  const id = converterNumero(idTexto);
  const capacidadeKwh = converterNumero(capacidadeTexto);
  const dodPercentual = converterNumero(dodTexto);
  const tensaoV = converterNumero(tensaoTexto);
  const precoBrl = converterNumero(precoTexto);
  const fonte = resto.join(',').trim();

  const valido =
    Number.isInteger(id) && id > 0 &&
    fabricante && modelo && tecnologia && fonte &&
    Number.isFinite(capacidadeKwh) && capacidadeKwh > 0 &&
    Number.isFinite(dodPercentual) && dodPercentual > 0 && dodPercentual <= 100 &&
    Number.isFinite(tensaoV) && tensaoV > 0 &&
    Number.isFinite(precoBrl) && precoBrl > 0 &&
    dataValida(dataConsulta);

  if (!valido) return null;
  return {
    id,
    fabricante,
    modelo,
    tecnologia,
    capacidadeKwh,
    dod: dodPercentual / 100,
    dodPercentual,
    tensaoV,
    precoBrl,
    dataConsulta,
    fonte
  };
}

function carregarBaterias(arquivo = ARQUIVO_PADRAO) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = linhas.shift()?.split(',').map((c) => c.trim()) || [];
  if (cabecalho.length !== COLUNAS.length || COLUNAS.some((c, i) => cabecalho[i] !== c)) {
    throw new Error(`dataset de baterias com cabeçalho inválido (esperado: ${COLUNAS.join(',')})`);
  }

  const baterias = [];
  for (const linha of linhas) {
    const bateria = lerLinha(linha);
    if (!bateria) throw new Error(`dataset de baterias com linha inválida: "${linha}"`);
    if (baterias.some((b) => b.id === bateria.id)) {
      throw new Error(`dataset de baterias com id duplicado: ${bateria.id}`);
    }
    baterias.push(bateria);
  }
  if (baterias.length === 0) throw new Error('dataset de baterias vazio');
  return baterias;
}

let cache = null;
function bateriasDisponiveis() {
  if (!cache) cache = carregarBaterias();
  return cache;
}

function selecionarBateria(bateriaId, baterias = bateriasDisponiveis()) {
  const id = converterNumero(bateriaId);
  if (!Number.isInteger(id) || id <= 0) return { erro: 'bateriaId deve ser um identificador válido' };
  const bateria = baterias.find((b) => b.id === id);
  if (!bateria) return { erro: 'bateria selecionada não encontrada' };
  return { bateria };
}

// PB15 — C_necessária é a energia útil requerida, sem aplicar DoD novamente.
function dimensionarBaterias({ bateria, energiaAutonomiaKwh, eficiencia }) {
  if (!bateria) return { erro: 'bateria selecionada é obrigatória' };
  if (!Number.isFinite(energiaAutonomiaKwh) || energiaAutonomiaKwh <= 0) {
    return { erro: 'energiaAutonomiaKwh deve ser maior que zero' };
  }
  if (!Number.isFinite(eficiencia) || eficiencia <= 0 || eficiencia > 1) {
    return { erro: 'eficiencia deve estar entre 0 e 1' };
  }

  const energiaUtilNecessariaKwh = energiaAutonomiaKwh / eficiencia;
  const capacidadeUtilUnitariaKwh = bateria.capacidadeKwh * bateria.dod;
  if (!Number.isFinite(capacidadeUtilUnitariaKwh) || capacidadeUtilUnitariaKwh <= 0) {
    return { erro: 'capacidade útil da bateria deve ser maior que zero' };
  }
  const quantidade = Math.ceil(energiaUtilNecessariaKwh / capacidadeUtilUnitariaKwh);
  const capacidadeInstaladaKwh = quantidade * bateria.capacidadeKwh;
  const custoBrl = quantidade * bateria.precoBrl;
  return {
    bateria,
    quantidade,
    energiaUtilNecessariaKwh: arredondar(energiaUtilNecessariaKwh),
    capacidadeUtilUnitariaKwh: arredondar(capacidadeUtilUnitariaKwh),
    capacidadeInstaladaKwh: arredondar(capacidadeInstaladaKwh),
    capacidadeUtilInstaladaKwh: arredondar(quantidade * capacidadeUtilUnitariaKwh),
    custoBrl: arredondar(custoBrl)
  };
}

function montarLogSelecaoBateria(resultado, energiaAutonomiaKwh, eficiencia) {
  return {
    etapa: 'SELECAO_BATERIA',
    formula: 'C_útil = C_nominal × DoD; N_bat = ceil((E_autonomia / η_bat) / C_útil)',
    entradas: {
      bateria_id: resultado.bateria.id,
      capacidade_nominal_kwh: resultado.bateria.capacidadeKwh,
      DoD: resultado.bateria.dod,
      E_autonomia_kwh: energiaAutonomiaKwh,
      eficiencia_bateria: eficiencia
    },
    resultado: resultado.quantidade,
    unidade: 'baterias'
  };
}

module.exports = {
  COLUNAS,
  carregarBaterias,
  bateriasDisponiveis,
  selecionarBateria,
  dimensionarBaterias,
  montarLogSelecaoBateria
};

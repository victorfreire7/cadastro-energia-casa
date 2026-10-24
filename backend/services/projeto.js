// PB19/PB20/PB21 — motor do projeto: encadeia os serviços já existentes
// (PB04 potência → PB05/06 módulos → PB07 inversor → PB08/09 geração → PB10–12 baterias
//  → PB13 orçamento → PB14 comparação → PB15 economia → PB16 payback → PB17 proposta)
// em um único cálculo. Funções puras: preços, potências e tensões vêm dos datasets
// (CSV), nenhum equipamento fica fixo aqui. A persistência fica no controller.

const { calcularEnergiaFv } = require('./dimensionamento');
const { dimensionarSistema, paineisDisponiveis } = require('./paineis');
const { calcularGeracaoFotovoltaica } = require('./geracaoFotovoltaica');
const { inversoresDisponiveis, avaliarCompatibilidade } = require('./inversores');
const { bateriasDisponiveis, selecionarBateria, dimensionarBaterias, montarLogSelecaoBateria } = require('./baterias');
const { EFICIENCIA_BATERIA_PADRAO, calcularCapacidadeBateria, montarLogCapacidadeBateria } = require('./armazenamento');
const { compararCenarios } = require('./comparacao');
const { montarProposta, montarOrcamento } = require('./proposta');
const { validarEntradaProjeto, mensagemIncompatibilidade, dividirSeguro } = require('./validacao');

const arred = (v, casas = 2) => Number(v.toFixed(casas));

// Arranjo simplificado das strings: usa o máximo de módulos em série que respeita a tensão
// máxima do inversor (Voc a 25 °C, sem correção de temperatura) e equilibra as strings.
function montarArranjo(painel, quantidade, inversor) {
  const maxSerie = Math.max(1, Math.floor(inversor.tensaoMaxV / painel.vocV));
  const strings = Math.ceil(quantidade / maxSerie);
  const modulosPorString = Math.ceil(quantidade / strings);
  return {
    modulosPorString,
    strings,
    vocStringV: arred(modulosPorString * painel.vocV),
    vmpStringV: arred(modulosPorString * painel.vmpV)
  };
}

// PB07 — compatibilidade técnica de um inversor com o arranjo (não olha o preço).
function avaliarInversor(inversor, painel, quantidade, potenciaInstaladaKwp) {
  const arranjo = montarArranjo(painel, quantidade, inversor);
  const { motivos } = avaliarCompatibilidade(inversor, {
    potenciaInstaladaKwp,
    tensaoStringVocV: arranjo.vocStringV,
    tensaoStringMppV: arranjo.vmpStringV,
    correnteModuloA: painel.correnteA
  });
  if (arranjo.strings > inversor.numMppt) {
    motivos.push(`o arranjo precisa de ${arranjo.strings} strings e o inversor tem ${inversor.numMppt} entrada(s) MPPT`);
  }
  return { arranjo, compativel: motivos.length === 0, motivos };
}

// Etapa 1 (tela): potência necessária, módulos, geração e a lista de inversores com
// o veredito de compatibilidade de cada um.
function preDimensionar({ consumoKwhMes, percentualAtendimento = 100, hsp, pr, painelId }) {
  const energia = calcularEnergiaFv(consumoKwhMes, percentualAtendimento);
  if (energia.erro) return { erros: [energia.erro] };

  const dim = dimensionarSistema({ energiaMensalKwh: energia.valor, hsp, eficiencia: pr, painelId });
  if (dim.erro) {
    return { erros: [dim.erro === 'painel não encontrado' ? 'O módulo escolhido não existe no dataset de módulos.' : dim.erro] };
  }

  const geracao = calcularGeracaoFotovoltaica({
    potenciaInstaladaKwp: dim.potenciaInstaladaKwp, hsp, pr, consumoMensalKwh: consumoKwhMes
  });
  if (geracao.erro) return { erros: [geracao.erro] };

  const inversores = inversoresDisponiveis().map((inv) => {
    const { compativel, motivos, arranjo } = avaliarInversor(inv, dim.painel, dim.quantidade, dim.potenciaInstaladaKwp);
    return {
      id: inv.id, fabricante: inv.fabricante, modelo: inv.modelo, potenciaKw: inv.potenciaW / 1000,
      precoBrl: inv.precoBrl, suportaBateria: inv.suportaBateria, bateriasCompativeis: inv.bateriasCompativeis,
      razaoCcCa: dividirSeguro(dim.potenciaInstaladaKwp * 1000, inv.potenciaW) === null ? null : arred(dim.potenciaInstaladaKwp * 1000 / inv.potenciaW),
      compativel, motivos, arranjo
    };
  });

  return { energiaFvKwhMes: energia.valor, dim, geracao, inversores };
}

function descricaoInversor(inv) {
  return { fabricante: inv.fabricante, modelo: inv.modelo, potenciaKw: inv.potenciaW / 1000 };
}

// Cálculo completo. `residencia` = { endereco, cidade, uf, potenciaInstaladaKw }.
// `consumo` = { kwhMes, origem }. `corpo` = campos do usuário (validados aqui, PB18).
function calcularProjeto({ residencia, consumo, corpo }) {
  const validacao = validarEntradaProjeto(corpo);
  if (validacao.erros) return { erros: validacao.erros };
  const e = validacao.entrada;

  const consumoKwhMes = e.consumoKwhMes ?? consumo.kwhMes;
  const consumoOrigem = e.consumoKwhMes !== undefined ? 'manual' : consumo.origem;
  if (!Number.isFinite(consumoKwhMes) || consumoKwhMes <= 0) {
    return { erros: ['Esta residência ainda não tem consumo calculado. Cadastre eletrodomésticos, registre o histórico ou informe o consumo manualmente.'] };
  }
  if (!residencia || !residencia.endereco || !residencia.cidade || !residencia.uf) {
    return { erros: ['A residência precisa ter endereço, cidade e UF. Complete o cadastro do imóvel.'] };
  }

  const pre = preDimensionar({
    consumoKwhMes, percentualAtendimento: e.percentualAtendimento, hsp: e.hsp, pr: e.pr, painelId: e.painelId
  });
  if (pre.erros) return { erros: pre.erros };
  const { dim, geracao, energiaFvKwhMes } = pre;
  const painel = dim.painel;

  // ----- inversor (PB07) -----
  const resolverInversor = (id, exigeBateria, bateria) => {
    const inv = inversoresDisponiveis().find((i) => i.id === id);
    if (!inv) return { erro: 'O inversor escolhido não existe no dataset de inversores.' };
    const av = avaliarInversor(inv, painel, dim.quantidade, dim.potenciaInstaladaKwp);
    if (!av.compativel) return { erro: mensagemIncompatibilidade(inv, av.motivos) };
    if (exigeBateria) {
      if (!inv.suportaBateria) {
        return { erro: `O inversor ${inv.fabricante} ${inv.modelo} não suporta baterias. Para o sistema com baterias, escolha um inversor híbrido.` };
      }
      const nome = `${bateria.fabricante} ${bateria.modelo}`;
      if (inv.bateriasCompativeis.length > 0 && !inv.bateriasCompativeis.includes(nome)) {
        return { erro: `O inversor ${inv.fabricante} ${inv.modelo} não é compatível com a bateria ${nome} (compatíveis: ${inv.bateriasCompativeis.join(', ')}).` };
      }
    }
    return { inv, arranjo: av.arranjo };
  };

  const semInv = resolverInversor(e.inversorId, false);
  if (semInv.erro) return { erros: [semInv.erro] };

  // ----- baterias (PB10–PB12) -----
  let bat = null;
  let comInv = null;
  const logs = [dim.log];
  if (e.comBaterias) {
    const sel = selecionarBateria(e.bateriaId);
    if (sel.erro) return { erros: ['A bateria escolhida não existe no dataset de baterias.'] };
    const cap = calcularCapacidadeBateria(consumoKwhMes, e.autonomiaHoras, sel.bateria.dod, EFICIENCIA_BATERIA_PADRAO);
    if (cap.erro) return { erros: [cap.erro] };
    const dimBat = dimensionarBaterias({ bateria: sel.bateria, energiaAutonomiaKwh: cap.energiaAutonomiaKwh, eficiencia: EFICIENCIA_BATERIA_PADRAO });
    if (dimBat.erro) return { erros: [dimBat.erro] };
    comInv = resolverInversor(e.inversorComBateriasId, true, sel.bateria);
    if (comInv.erro) return { erros: [comInv.erro] };
    bat = { ...dimBat, cap };
    logs.push(montarLogCapacidadeBateria(consumoKwhMes, e.autonomiaHoras, cap));
    logs.push(montarLogSelecaoBateria(dimBat, cap.energiaAutonomiaKwh, EFICIENCIA_BATERIA_PADRAO));
  }

  // ----- orçamento (PB13) e proposta de cada alternativa (PB14–PB17) -----
  const modulos = { fabricante: painel.fabricante, modelo: painel.modelo, quantidade: dim.quantidade, potenciaWp: painel.potenciaWp };
  const itensBase = (inv) => {
    const itens = [
      { equipamento: 'Módulo fotovoltaico', fabricanteModelo: `${painel.fabricante} ${painel.modelo}`, quantidade: dim.quantidade, precoUnitario: painel.precoBrl },
      { equipamento: 'Inversor', fabricanteModelo: `${inv.fabricante} ${inv.modelo}`, quantidade: 1, precoUnitario: inv.precoBrl }
    ];
    return itens;
  };
  const complemento = e.custoComplementarBrl
    ? [{ equipamento: 'Custos complementares', fabricanteModelo: e.custoComplementarDescricao, quantidade: 1, precoUnitario: e.custoComplementarBrl }]
    : [];

  const baseProposta = (inv) => ({
    residencia: { endereco: residencia.endereco, cidade: residencia.cidade, uf: residencia.uf },
    consumo: { mensalKwh: consumoKwhMes, potenciaInstaladaKw: residencia.potenciaInstaladaKw },
    recursoSolar: { hsp: e.hsp, hspFonte: e.hspFonte, pr: e.pr, prJustificativa: e.prJustificativa },
    potenciaFvNecessariaKwp: dim.potenciaNecessariaKwp,
    potenciaInstaladaKwp: dim.potenciaInstaladaKwp,
    modulos,
    inversor: descricaoInversor(inv),
    geracaoMensalKwh: geracao.geracaoMensalKwh,
    atendimentoPercent: geracao.atendimentoPercentual,
    energiaCompensadaKwhMes: geracao.energiaCompensadaKwh,
    tarifa: { valorReaisKwh: e.tarifaReaisKwh, fonte: e.tarifaFonte }
  });

  const entradaSem = { ...baseProposta(semInv.inv), orcamento: { itens: [...itensBase(semInv.inv), ...complemento] } };
  const propostaSem = montarProposta(entradaSem);
  if (propostaSem.erros) return { erros: propostaSem.erros };

  let propostaCom = null;
  let comparacao = null;
  if (bat) {
    const bateriaDesc = {
      fabricante: bat.bateria.fabricante, modelo: bat.bateria.modelo,
      quantidade: bat.quantidade, capacidadeTotalKwh: bat.capacidadeInstaladaKwh
    };
    const entradaCom = {
      ...baseProposta(comInv.inv),
      bateria: bateriaDesc,
      autonomiaHoras: e.autonomiaHoras,
      orcamento: {
        itens: [
          ...itensBase(comInv.inv),
          { equipamento: 'Bateria', fabricanteModelo: `${bat.bateria.fabricante} ${bat.bateria.modelo}`, quantidade: bat.quantidade, precoUnitario: bat.bateria.precoBrl },
          ...complemento
        ]
      }
    };
    propostaCom = montarProposta(entradaCom);
    if (propostaCom.erros) return { erros: propostaCom.erros };

    const cenario = (entrada, proposta) => ({
      potenciaFvNecessariaKwp: entrada.potenciaFvNecessariaKwp,
      potenciaInstaladaKwp: entrada.potenciaInstaladaKwp,
      modulos: entrada.modulos,
      inversor: entrada.inversor,
      geracaoMensalKwh: entrada.geracaoMensalKwh,
      atendimentoPercent: entrada.atendimentoPercent,
      bateria: entrada.bateria || null,
      autonomiaHoras: entrada.autonomiaHoras ?? null,
      investimentoTotal: proposta.orcamento.total
    });
    comparacao = compararCenarios({
      semBaterias: cenario(entradaSem, propostaSem),
      comBaterias: cenario(entradaCom, propostaCom)
    });
    if (comparacao.erros) return { erros: comparacao.erros };
  }

  const avisos = [...propostaSem.avisos, ...((propostaCom && propostaCom.avisos) || [])];
  if (propostaSem.consumo.potenciaInstaladaKw === null) avisos.push('A residência não tem potência instalada informada (carga dos equipamentos).');

  return {
    alternativaSelecionada: e.comBaterias ? 'com' : 'sem',
    consumo: {
      mensalKwh: arred(consumoKwhMes),
      diarioKwh: arred(consumoKwhMes / 30),
      origem: consumoOrigem,
      potenciaInstaladaKw: residencia.potenciaInstaladaKw
    },
    recursoSolar: { hsp: e.hsp, hspFonte: e.hspFonte, pr: e.pr, prJustificativa: e.prJustificativa },
    percentualAtendimento: e.percentualAtendimento,
    energiaFvAlvoKwhMes: energiaFvKwhMes,
    dimensionamento: {
      potenciaNecessariaKwp: dim.potenciaNecessariaKwp,
      potenciaInstaladaKwp: dim.potenciaInstaladaKwp,
      modulos: { id: painel.id, ...modulos, fonte: painel.fonte, dataConsulta: painel.dataConsulta },
      arranjo: semInv.arranjo
    },
    geracao,
    inversor: {
      id: semInv.inv.id, ...descricaoInversor(semInv.inv),
      razaoCcCa: arred(dim.potenciaInstaladaKwp * 1000 / semInv.inv.potenciaW),
      fonte: semInv.inv.fonte, dataConsulta: semInv.inv.dataConsulta
    },
    armazenamento: bat ? {
      bateriaId: bat.bateria.id,
      autonomiaHoras: e.autonomiaHoras,
      energiaAutonomiaKwh: bat.cap.energiaAutonomiaKwh,
      capacidadeNominalNecessariaKwh: bat.capacidadeNominalNecessariaKwh,
      quantidade: bat.quantidade,
      capacidadeInstaladaKwh: bat.capacidadeInstaladaKwh,
      inversorHibrido: { id: comInv.inv.id, ...descricaoInversor(comInv.inv) },
      fonte: bat.bateria.fonte, dataConsulta: bat.bateria.dataConsultaPreco
    } : null,
    semBaterias: propostaSem,
    comBaterias: propostaCom,
    comparacao,
    proposta: e.comBaterias ? propostaCom : propostaSem,
    avisos,
    memoriaCalculo: logs
  };
}

module.exports = { montarArranjo, avaliarInversor, preDimensionar, calcularProjeto, paineisDisponiveis, bateriasDisponiveis, inversoresDisponiveis };

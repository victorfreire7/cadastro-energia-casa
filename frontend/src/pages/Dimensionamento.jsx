import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { UFS } from '../constants/ufs.js';

const ORIGEM_LABEL = {
  historico: 'média do histórico registrado',
  estimado: 'estimativa pelos eletrodomésticos cadastrados',
  manual: 'valor informado manualmente'
};

const HSP_FAIXA_PADRAO = { min: 3, max: 6.5 };

// PB03 — mesma faixa plausível do backend
function validarHspLocal(texto, faixa) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'o HSP deve ser um número';
  const numero = Number(valor);
  if (numero < faixa.min || numero > faixa.max) {
    return `o HSP deve estar entre ${faixa.min} e ${faixa.max} h/dia`;
  }
  return '';
}

// PB04 — E_FV = C_m × f  (f = percentual / 100); mesma regra do backend
function calcularEnergiaFvLocal(consumo, percentual) {
  if (!Number.isFinite(consumo) || consumo <= 0) return null;
  if (!Number.isFinite(percentual) || percentual < 1 || percentual > 100) return null;
  return Number((consumo * (percentual / 100)).toFixed(2));
}

// PB02 — mesmas regras do backend, para feedback imediato
function validarPercentualLocal(texto) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return 'informe o percentual (padrão: 100%)';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'o percentual deve ser um número';
  const numero = Number(valor);
  if (numero < 0) return 'o percentual não pode ser negativo';
  if (numero < 1 || numero > 100) return 'o percentual deve estar entre 1% e 100%';
  return '';
}

// PB12 — mesma faixa de autonomia do backend (horas)
function validarAutonomiaLocal(texto) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return 'informe a autonomia desejada em horas';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'a autonomia deve ser um número';
  const numero = Number(valor);
  if (numero <= 0) return 'a autonomia deve ser um valor positivo';
  if (numero < 1 || numero > 72) return 'a autonomia deve estar entre 1 e 72 horas';
  return '';
}

export default function Dimensionamento() {
  const { imovelId } = useParams();
  const navigate = useNavigate();

  const [imoveis, setImoveis] = useState([]);
  const [referencia, setReferencia] = useState(null);
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [consumoManual, setConsumoManual] = useState('');
  const [percentual, setPercentual] = useState('100');
  const [erro, setErro] = useState('');
  const [erroPercentual, setErroPercentual] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [cenario, setCenario] = useState(null);
  const [hspTabela, setHspTabela] = useState(null);
  const [hspManual, setHspManual] = useState('');
  const [logs, setLogs] = useState(null);
  const [comArmazenamento, setComArmazenamento] = useState(false);
  const [autonomia, setAutonomia] = useState('');
  const [erroAutonomia, setErroAutonomia] = useState('');
  const [dadosBaterias, setDadosBaterias] = useState({ padroes: { dod: 0.8, eficiencia: 0.9 }, baterias: [] });
  const [bateriasErro, setBateriasErro] = useState('');
  const [bateriaId, setBateriaId] = useState('');
  const [paineis, setPaineis] = useState([]);
  const [inversores, setInversores] = useState([]);
  const [painelId, setPainelId] = useState('');
  const [inversorId, setInversorId] = useState('');
  const [eficienciaSistema, setEficienciaSistema] = useState('0.75');
  const [diasReferencia, setDiasReferencia] = useState('30');
  const [custosExtras, setCustosExtras] = useState({ custoEstruturaBrl: '0', custoCabeamentoBrl: '0', custoProtecoesBrl: '0', custoInstalacaoBrl: '0', fontesCustosComplementares: '' });
  const [alternativasInversor, setAlternativasInversor] = useState([]);
  const [cenariosSalvos, setCenariosSalvos] = useState([]);
  const [cenarioEditandoId, setCenarioEditandoId] = useState(null);

  // PB01 task 2 — lista de imóveis para seleção
  useEffect(() => {
    api
      .get('/imoveis')
      .then(({ data }) => setImoveis(data))
      .catch(() => setErro('não foi possível carregar seus imóveis'))
      .finally(() => !imovelId && setCarregando(false));
  }, []);

  useEffect(() => {
    Promise.all([api.get('/dimensionamento/paineis'), api.get('/dimensionamento/inversores')])
      .then(([p, i]) => { setPaineis(p.data.paineis); setEficienciaSistema(String(p.data.eficienciaPadrao)); setInversores(i.data.inversores); })
      .catch(() => setErro('não foi possível carregar os catálogos de módulos e inversores'));
  }, []);

  useEffect(() => {
    api
      .get('/dimensionamento/baterias')
      .then(({ data }) => setDadosBaterias(data))
      .catch(() => setBateriasErro('não foi possível carregar as baterias disponíveis'));
  }, []);

  // PB01 tasks 1 e 3 — consumo e localidade já cadastrados
  useEffect(() => {
    if (!imovelId) {
      setReferencia(null);
      return;
    }
    setCarregando(true);
    setErro('');
    setCenario(null);
    setConsumoManual('');
    api.get(`/imoveis/${imovelId}/cenarios`).then(({ data }) => setCenariosSalvos(data)).catch(() => setCenariosSalvos([]));
    api
      .get(`/imoveis/${imovelId}/dimensionamento/referencia`)
      .then(({ data }) => {
        setReferencia(data);
        setCidade(data.localidade.cidade || '');
        setUf(data.localidade.uf || '');
      })
      .catch(() => setErro('não foi possível carregar os dados do imóvel'))
      .finally(() => setCarregando(false));
  }, [imovelId]);

  // PB03 — HSP associado à UF informada (recarrega ao ajustar a localidade)
  useEffect(() => {
    if (!uf) {
      setHspTabela(null);
      return;
    }
    api
      .get('/dimensionamento/hsp', { params: { uf } })
      .then(({ data }) => setHspTabela(data))
      .catch(() => setHspTabela(null));
  }, [uf]);

  const faixaHsp = hspTabela?.faixa || referencia?.faixaHsp || HSP_FAIXA_PADRAO;
  const erroHsp = validarHspLocal(hspManual, faixaHsp);
  const hspManualValido = hspManual.trim() !== '' && !erroHsp;
  const semHsp = !hspTabela && !hspManualValido;
  const hspEfetivo = hspManualValido ? Number(hspManual.replace(',', '.')) : hspTabela?.hsp;

  const manualPreenchido = consumoManual.trim() !== '';
  const manualNumero = Number(consumoManual.replace(',', '.'));
  const manualValido = manualPreenchido && Number.isFinite(manualNumero) && manualNumero > 0;

  // PB01 tasks 5 e 6 — sem referência (nem histórico/estimativa, nem manual) bloqueia o fluxo
  const semReferencia = referencia && !referencia.sugestao && !manualValido;
  const consumoEfetivo = manualValido ? manualNumero : referencia?.sugestao?.consumoKwhMes;
  const origemEfetiva = manualValido ? 'manual' : referencia?.sugestao?.origem;

  // PB04 — recalcula a cada mudança de consumo ou percentual
  const percentualNumero = Number(percentual.trim().replace(',', '.'));
  const energiaFv = calcularEnergiaFvLocal(consumoEfetivo, percentualNumero);
  const bateriaSelecionada = dadosBaterias.baterias.find((b) => b.id === Number(bateriaId));
  const autonomiaNumero = Number(autonomia.trim().replace(',', '.'));
  const autonomiaValida = Number.isFinite(autonomiaNumero) && autonomiaNumero >= 1 && autonomiaNumero <= 72;
  const energiaAutonomia = Number.isFinite(consumoEfetivo) && consumoEfetivo > 0 && autonomiaValida
    ? (consumoEfetivo / 30) * (autonomiaNumero / 24)
    : null;
  const capacidadeBateriaNecessaria = energiaAutonomia === null
    ? null
    : energiaAutonomia / (dadosBaterias.padroes.dod * dadosBaterias.padroes.eficiencia);
  const energiaUtilNecessaria = energiaAutonomia === null
    ? null
    : energiaAutonomia / dadosBaterias.padroes.eficiencia;
  const capacidadeUtilUnitaria = bateriaSelecionada
    ? bateriaSelecionada.capacidadeKwh * bateriaSelecionada.dod
    : null;
  const quantidadeBaterias = capacidadeUtilUnitaria && energiaUtilNecessaria
    ? Math.ceil(energiaUtilNecessaria / capacidadeUtilUnitaria)
    : null;
  const painelSelecionado = paineis.find((p) => p.id === Number(painelId));
  const potenciaSistemaKwp = energiaFv && hspEfetivo && Number(eficienciaSistema) > 0
    ? energiaFv / (hspEfetivo * Number(diasReferencia) * Number(eficienciaSistema)) : null;
  const quantidadePaineis = painelSelecionado && potenciaSistemaKwp
    ? Math.ceil(potenciaSistemaKwp * 1000 / painelSelecionado.potenciaWp) : null;
  const potenciaInstaladaKwp = painelSelecionado && quantidadePaineis
    ? quantidadePaineis * painelSelecionado.potenciaWp / 1000 : null;
  const bateriaCompativel = (inversor) => !comArmazenamento || (bateriaSelecionada && inversor.suportaBateria && inversor.bateriasCompativeis.some((nome) => `${bateriaSelecionada.fabricante} ${bateriaSelecionada.modelo}`.includes(nome)));
  const inversoresFiltrados = inversores.filter(bateriaCompativel);
  const inversorSelecionado = inversores.find((i) => i.id === Number(inversorId));
  const custoPaineisPreview = painelSelecionado && quantidadePaineis ? painelSelecionado.precoBrl * quantidadePaineis : 0;
  const custoBateriasPreview = bateriaSelecionada && quantidadeBaterias ? bateriaSelecionada.precoBrl * quantidadeBaterias : 0;
  const custoEquipamentosPreview = custoPaineisPreview + (inversorSelecionado?.precoBrl || 0) + custoBateriasPreview;
  const custosExtrasPreview = ['custoEstruturaBrl', 'custoCabeamentoBrl', 'custoProtecoesBrl', 'custoInstalacaoBrl'].reduce((soma, chave) => soma + (Number(custosExtras[chave]) || 0), 0);

  function handleAutonomia(valor) {
    setAutonomia(valor);
    setErroAutonomia(validarAutonomiaLocal(valor));
  }

  function handlePercentual(valor) {
    setPercentual(valor);
    setErroPercentual(validarPercentualLocal(valor));
  }

  async function carregarLogs() {
    try {
      const { data } = await api.get(`/imoveis/${imovelId}/cenarios/${cenario.id}/logs`);
      setLogs(data);
    } catch (err) {
      setErro('não foi possível carregar a memória de cálculo');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setAlternativasInversor([]);

    const erroLocal = validarPercentualLocal(percentual);
    if (erroLocal) {
      setErroPercentual(erroLocal);
      return;
    }
    if (manualPreenchido && !manualValido) {
      setErro('o consumo de referência deve ser um número maior que zero');
      return;
    }

    if (erroHsp) {
      setErro(erroHsp);
      return;
    }

    if (comArmazenamento) {
      const erroAut = validarAutonomiaLocal(autonomia);
      if (erroAut) {
        setErroAutonomia(erroAut);
        return;
      }
      if (!bateriaId || !bateriaSelecionada) {
        setErro('selecione uma bateria disponível');
        return;
      }
    }
    if (!painelId || !inversorId) {
      setErro('selecione um módulo e um inversor para calcular o sistema e o orçamento');
      return;
    }
    if (!inversorSelecionado || !bateriaCompativel(inversorSelecionado)) {
      setErro('o inversor selecionado não é compatível com a bateria. Escolha um inversor híbrido compatível.');
      return;
    }
    if (!potenciaInstaladaKwp || potenciaInstaladaKwp * 1000 > inversorSelecionado.potenciaMaxPvW || potenciaInstaladaKwp * 1000 > inversorSelecionado.potenciaW * 1.5) {
      setErro('o inversor não suporta a potência calculada. Selecione uma alternativa compatível.');
      setAlternativasInversor(inversores.filter((i) => bateriaCompativel(i) && potenciaInstaladaKwp * 1000 <= i.potenciaMaxPvW && potenciaInstaladaKwp * 1000 <= i.potenciaW * 1.5));
      return;
    }
    if (Number(eficienciaSistema) <= 0 || Number(eficienciaSistema) > 1 || !Number.isInteger(Number(diasReferencia)) || Number(diasReferencia) < 1 || Number(diasReferencia) > 31 || ['custoEstruturaBrl', 'custoCabeamentoBrl', 'custoProtecoesBrl', 'custoInstalacaoBrl'].some((k) => Number(custosExtras[k]) < 0 || !Number.isFinite(Number(custosExtras[k])))) {
      setErro('verifique a eficiência (entre 0 e 100%), os dias de referência (1 a 31) e os custos complementares (não negativos)');
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        cidade,
        uf,
        percentualAtendimento: percentual.trim().replace(',', '.'),
        ...(manualValido && { consumoReferenciaKwh: manualNumero }),
        ...(hspManualValido && { hspKwhM2Dia: hspEfetivo }),
        armazenamento: comArmazenamento,
        ...(comArmazenamento && {
          autonomiaHoras: autonomia.trim().replace(',', '.'),
          bateriaId: Number(bateriaId)
        }),
        painelId: Number(painelId),
        inversorId: Number(inversorId),
        eficienciaSistema: Number(eficienciaSistema),
        diasReferencia: Number(diasReferencia),
        ...Object.fromEntries(Object.entries(custosExtras).filter(([key]) => key !== 'fontesCustosComplementares').map(([key, value]) => [key, Number(value)])),
        fontesCustosComplementares: custosExtras.fontesCustosComplementares
      };
      const { data } = cenarioEditandoId
        ? await api.put(`/imoveis/${imovelId}/cenarios/${cenarioEditandoId}`, payload)
        : await api.post(`/imoveis/${imovelId}/cenarios`, payload);
      setCenario(data);
      setCenarioEditandoId(null);
      setCenariosSalvos((atual) => [data, ...atual.filter((c) => c.id !== data.id)]);
      setLogs(null);
    } catch (err) {
      setErro(err.response?.data?.message || 'não foi possível salvar o cenário');
      setAlternativasInversor(err.response?.data?.alternativas || []);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="dashboard">
      <Link to="/dashboard" className="back-link">
        ← Voltar
      </Link>
      <h1>Dimensionamento fotovoltaico</h1>
      <p className="imovel-meta">Passo 1 — consumo de referência, localização, HSP e percentual de atendimento</p>

      {erro && <div className="error-message">
        {erro}
        {alternativasInversor.length > 0 && <div>
          <p>Alternativas compatíveis do catálogo:</p>
          {alternativasInversor.map((i) => <button key={i.id} type="button" className="btn-secondary btn-inline" onClick={() => { setInversorId(String(i.id)); setErro(''); setAlternativasInversor([]); }}>{i.fabricante} {i.modelo}</button>)}
        </div>}
      </div>}

      <div className="field">
        <label htmlFor="imovel">Imóvel de referência</label>
        <select
          id="imovel"
          value={imovelId || ''}
          onChange={(e) => navigate(e.target.value ? `/dimensionamento/novo/${e.target.value}` : '/dimensionamento/novo')}
        >
          <option value="">Selecione um imóvel</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.endereco}
            </option>
          ))}
        </select>
      </div>

      {imovelId && cenariosSalvos.length > 0 && !cenario && (
        <div className="field">
          <label htmlFor="cenarioAnterior">Cenários salvos deste imóvel</label>
          <select id="cenarioAnterior" value="" onChange={(e) => setCenario(cenariosSalvos.find((c) => c.id === Number(e.target.value)) || null)}>
            <option value="">Abrir um cenário salvo</option>
            {cenariosSalvos.map((c) => <option key={c.id} value={c.id}>{new Date(c.createdAt).toLocaleDateString('pt-BR')} — {c.consumoReferenciaKwh} kWh/mês, {c.armazenamento ? 'com baterias' : 'sem baterias'}</option>)}
          </select>
        </div>
      )}

      {imovelId && carregando && <p>Carregando...</p>}

      {referencia && !carregando && !cenario && (
        <form onSubmit={handleSubmit}>
          {cenarioEditandoId && <p className="imovel-meta">Editando o cenário salvo #{cenarioEditandoId}.</p>}
          <h2 className="section-title">Localização</h2>
          <div className="localidade-row">
            <div className="field">
              <label htmlFor="cidade">Cidade</label>
              <input id="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="uf">UF</label>
              <select id="uf" value={uf} onChange={(e) => setUf(e.target.value)} required>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="imovel-meta">
            {referencia.localidade.cidade
              ? `Localidade cadastrada: ${referencia.localidade.cidade}/${referencia.localidade.uf}. Confirme ou ajuste.`
              : 'Este imóvel ainda não tem localidade cadastrada. Informe cidade e UF.'}
          </p>

          <h2 className="section-title">Consumo de referência</h2>
          {referencia.sugestao ? (
            <>
              <p className="metric total-consumo">{referencia.sugestao.consumoKwhMes} kWh/mês</p>
              <p className="imovel-meta">
                Origem: {ORIGEM_LABEL[referencia.sugestao.origem]}
                {referencia.sugestao.origem === 'historico' &&
                  ` (${referencia.sugestao.mesesHistorico} ${referencia.sugestao.mesesHistorico === 1 ? 'mês' : 'meses'})`}
                .
              </p>
              {referencia.sugestao.origem === 'estimado' && (
                <p className="imovel-meta">
                  Ainda não há histórico mensal (mínimo: {referencia.historicoMinimoMeses}). Registre uma leitura
                  no detalhe do imóvel para usar o consumo real.
                </p>
              )}
            </>
          ) : (
            <div className="error-message">
              Este imóvel não tem consumo de referência: não há histórico registrado nem eletrodomésticos
              cadastrados. Registre o consumo no imóvel ou informe o valor manualmente abaixo para continuar.
            </div>
          )}

          <div className="field">
            <label htmlFor="consumoManual">Ajustar consumo de referência (kWh/mês) — opcional</label>
            <input
              id="consumoManual"
              type="number"
              min="0.01"
              step="any"
              placeholder={referencia.sugestao ? `Deixe vazio para usar ${referencia.sugestao.consumoKwhMes}` : 'Ex.: 350'}
              value={consumoManual}
              onChange={(e) => setConsumoManual(e.target.value)}
            />
          </div>

          <h2 className="section-title">Percentual do consumo a atender</h2>
          <div className="field">
            <label htmlFor="percentual">Percentual (1% a 100%)</label>
            <input
              id="percentual"
              type="number"
              min="1"
              max="100"
              step="any"
              value={percentual}
              onChange={(e) => handlePercentual(e.target.value)}
              aria-invalid={erroPercentual ? 'true' : 'false'}
            />
            {erroPercentual && <div className="field-error">{erroPercentual}</div>}
          </div>
          <button type="button" className="btn-secondary btn-inline" onClick={() => handlePercentual('100')}>
            Usar 100%
          </button>

          <h2 className="section-title">Recurso solar (HSP)</h2>
          {hspTabela ? (
            <>
              <p className="metric total-consumo">{hspTabela.hsp} h/dia</p>
              <p className="imovel-meta">
                Região {hspTabela.regiao} ({hspTabela.uf}). Fonte: {hspTabela.fonte}.
              </p>
            </>
          ) : (
            <div className="error-message">
              {uf
                ? 'Não há HSP cadastrado para esta UF. Informe o HSP manualmente.'
                : 'Informe a UF para carregar o HSP da localidade.'}
            </div>
          )}
          <div className="field">
            <label htmlFor="hspManual">
              Sobrescrever HSP (h/dia, entre {faixaHsp.min} e {faixaHsp.max}) — opcional
            </label>
            <input
              id="hspManual"
              type="number"
              step="any"
              min={faixaHsp.min}
              max={faixaHsp.max}
              value={hspManual}
              onChange={(e) => setHspManual(e.target.value)}
              aria-invalid={erroHsp ? 'true' : 'false'}
            />
            {erroHsp && <div className="field-error">{erroHsp}</div>}
            {hspManualValido && (
              <div className="imovel-meta">Será usado o valor informado manualmente em vez da tabela.</div>
            )}
          </div>

          <h2 className="section-title">Armazenamento por baterias</h2>
          <div className="field">
            <label htmlFor="armazenamento">Sistema de armazenamento</label>
            <select
              id="armazenamento"
              value={comArmazenamento ? 'com' : 'sem'}
              onChange={(e) => {
                setComArmazenamento(e.target.value === 'com');
                setErroAutonomia('');
              }}
            >
              <option value="sem">Sem baterias</option>
              <option value="com">Com baterias</option>
            </select>
          </div>
          {comArmazenamento ? (
            <>
              <div className="field">
                <label htmlFor="autonomia">Autonomia desejada (horas, entre 1 e 72)</label>
                <input
                  id="autonomia"
                  type="number"
                  min="1"
                  max="72"
                  step="any"
                  value={autonomia}
                  onChange={(e) => handleAutonomia(e.target.value)}
                  aria-invalid={erroAutonomia ? 'true' : 'false'}
                />
                {erroAutonomia && <div className="field-error">{erroAutonomia}</div>}
              </div>
              <div className="field">
                <label htmlFor="bateria">Bateria</label>
                <select id="bateria" value={bateriaId} onChange={(e) => setBateriaId(e.target.value)} required>
                  <option value="">Selecione uma bateria</option>
                  {dadosBaterias.baterias.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.fabricante} {b.modelo} — {b.capacidadeKwh} kWh, {b.tensaoV} V
                    </option>
                  ))}
                </select>
                {bateriasErro && <div className="field-error">{bateriasErro}</div>}
                {bateriaSelecionada && (
                  <p className="imovel-meta">
                    DoD {bateriaSelecionada.dodPercentual}%; R$ {Number(bateriaSelecionada.precoBrl).toFixed(2).replace('.', ',')} por unidade.
                    {' '}Fonte técnica e preço consultados em {bateriaSelecionada.dataConsulta}.
                  </p>
                )}
              </div>
              {capacidadeBateriaNecessaria !== null && (
                <div className="imovel-meta">
                  <p>
                    PB13: E_d = {(consumoEfetivo / 30).toFixed(2)} kWh/dia; E_autonomia = {energiaAutonomia.toFixed(2)} kWh;
                    {' '}C_bat estimada = {capacidadeBateriaNecessaria.toFixed(2)} kWh nominais
                    {' '}(DoD padrão {dadosBaterias.padroes.dod * 100}% e eficiência {dadosBaterias.padroes.eficiencia * 100}%).
                  </p>
                  {bateriaSelecionada && quantidadeBaterias !== null && (
                    <p>
                      PB15: {quantidadeBaterias} × {bateriaSelecionada.modelo}; capacidade instalada =
                      {' '}{(quantidadeBaterias * bateriaSelecionada.capacidadeKwh).toFixed(2)} kWh nominais
                      {' '}({(quantidadeBaterias * capacidadeUtilUnitaria).toFixed(2)} kWh úteis).
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="imovel-meta">Sem baterias: o custo de baterias é considerado R$ 0,00.</p>
          )}

          <h2 className="section-title">Energia mensal a gerar (E_FV)</h2>
          {energiaFv !== null ? (
            <>
              <p className="metric total-consumo">{energiaFv} kWh/mês</p>
              <p className="imovel-meta">
                E_FV = C_m × f = {consumoEfetivo} kWh/mês × {percentualNumero / 100}
              </p>
            </>
          ) : (
            <p className="imovel-meta">
              Defina um consumo de referência válido e um percentual entre 1% e 100% para calcular.
            </p>
          )}

          <h2 className="section-title">Módulos e inversor</h2>
          <div className="field">
            <label htmlFor="painel">Módulo fotovoltaico</label>
            <select id="painel" value={painelId} onChange={(e) => setPainelId(e.target.value)} required>
              <option value="">Selecione um módulo</option>
              {paineis.map((p) => <option key={p.id} value={p.id}>{p.fabricante} {p.modelo} — {p.potenciaWp} Wp · R$ {p.precoBrl.toFixed(2)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="eficiencia">Eficiência global do sistema (η), entre 1% e 100%</label>
            <input id="eficiencia" type="number" min="0.01" max="1" step="0.01" value={eficienciaSistema} onChange={(e) => setEficienciaSistema(e.target.value)} />
            <p className="imovel-meta">Eficiência padrão 75%, editável. D é configurável entre 1 e 31 dias (padrão 30). A estimativa não substitui o projeto elétrico de strings.</p>
          </div>
          <div className="field">
            <label htmlFor="diasReferencia">Dias de referência no mês (D)</label>
            <input id="diasReferencia" type="number" min="1" max="31" step="1" value={diasReferencia} onChange={(e) => setDiasReferencia(e.target.value)} />
          </div>
          {potenciaSistemaKwp !== null && painelSelecionado && (
            <p className="imovel-meta">
              PB05–08: potência calculada {potenciaSistemaKwp.toFixed(2)} kWp; {quantidadePaineis} módulos; potência instalada {potenciaInstaladaKwp.toFixed(2)} kWp
              {potenciaInstaladaKwp >= potenciaSistemaKwp ? ' (cobre a potência calculada).' : ' (abaixo da potência calculada).'}
            </p>
          )}
          <div className="field">
            <label htmlFor="inversor">Inversor</label>
            <select id="inversor" value={inversorId} onChange={(e) => setInversorId(e.target.value)} required>
              <option value="">Selecione um inversor</option>
              {inversoresFiltrados.map((i) => <option key={i.id} value={i.id}>{i.fabricante} {i.modelo} — {i.potenciaW / 1000} kW{i.suportaBateria ? ' · híbrido, compatível com bateria' : ' · sem suporte a bateria'}</option>)}
            </select>
            {comArmazenamento && bateriaId && inversoresFiltrados.length === 0 && <div className="error-message">Nenhum inversor do catálogo declara compatibilidade com essa bateria. Selecione Dyness B4850 para usar o inversor híbrido cadastrado.</div>}
          </div>
          {painelSelecionado && <p className="imovel-meta">Módulo: ficha técnica e preço de varejo consultados em {painelSelecionado.dataConsulta}. Fonte: {painelSelecionado.fonte}</p>}

          <h2 className="section-title">Custos complementares</h2>
          <p className="imovel-meta">Informe os valores da proposta/instalação. Os padrões são R$ 0,00 e representam itens ainda não orçados.</p>
          {[
            ['custoEstruturaBrl', 'Estrutura de fixação'],
            ['custoCabeamentoBrl', 'Cabeamento'],
            ['custoProtecoesBrl', 'Proteções elétricas'],
            ['custoInstalacaoBrl', 'Instalação']
          ].map(([key, label]) => <div className="field" key={key}>
            <label htmlFor={key}>{label} (R$)</label>
            <input id={key} type="number" min="0" step="0.01" value={custosExtras[key]} onChange={(e) => setCustosExtras({ ...custosExtras, [key]: e.target.value })} />
          </div>)}
          <div className="field">
            <label htmlFor="fonteCustos">Fontes ou premissas dos custos (ex.: proposta do instalador, data, escopo)</label>
            <input id="fonteCustos" value={custosExtras.fontesCustosComplementares} onChange={(e) => setCustosExtras({ ...custosExtras, fontesCustosComplementares: e.target.value })} />
          </div>
          <div className="imovel-meta">
            <p>PB17 — Equipamentos: módulos R$ {custoPaineisPreview.toFixed(2)} + inversor R$ {(inversorSelecionado?.precoBrl || 0).toFixed(2)} + baterias R$ {custoBateriasPreview.toFixed(2)} = R$ {custoEquipamentosPreview.toFixed(2)}.</p>
            <p>PB18 — Total estimado: equipamentos R$ {custoEquipamentosPreview.toFixed(2)} + complementares R$ {custosExtrasPreview.toFixed(2)} = R$ {(custoEquipamentosPreview + custosExtrasPreview).toFixed(2)}.</p>
          </div>

          <button
            className="btn-primary"
            type="submit"
            disabled={salvando || semReferencia || semHsp || !!erroPercentual || !!erroHsp || !!erroAutonomia}
          >
            {salvando ? 'Salvando...' : cenarioEditandoId ? 'Salvar alterações' : 'Salvar cenário e continuar'}
          </button>
          {semReferencia && (
            <p className="imovel-meta">Defina um consumo de referência para avançar.</p>
          )}
          {cenarioEditandoId && <button type="button" className="btn-secondary btn-inline" onClick={() => { setCenarioEditandoId(null); setCenario(cenariosSalvos.find((c) => c.id === cenarioEditandoId) || null); }}>Cancelar edição</button>}
        </form>
      )}

      {cenario && (
        <div className="resultado-cenario">
          <h2 className="section-title">Cenário salvo</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Localidade</th>
                <td>
                  {cenario.cidade}/{cenario.uf}
                </td>
              </tr>
              <tr>
                <th>Consumo de referência</th>
                <td className="metric">{cenario.consumoReferenciaKwh} kWh/mês</td>
              </tr>
              <tr>
                <th>Origem do consumo</th>
                <td>{ORIGEM_LABEL[cenario.consumoOrigem]}</td>
              </tr>
              <tr>
                <th>Percentual a atender</th>
                <td className="metric">{cenario.percentualAtendimento}%</td>
              </tr>
              <tr>
                <th>Energia mensal a gerar (E_FV)</th>
                <td className="metric">{cenario.energiaMensalFvKwh} kWh/mês</td>
              </tr>
              <tr>
                <th>Potência calculada / instalada</th>
                <td className="metric">{cenario.potenciaSistemaKwp ?? '—'} / {cenario.potenciaInstaladaKwp ?? '—'} kWp</td>
              </tr>
              <tr>
                <th>Módulos instalados</th>
                <td>{paineis.find((p) => p.id === cenario.painelId)?.modelo || '—'} · {cenario.quantidadePaineis ?? '—'} unidades</td>
              </tr>
              <tr>
                <th>Inversor</th>
                <td>{inversores.find((i) => i.id === cenario.inversorId)?.modelo || '—'}</td>
              </tr>
              <tr>
                <th>HSP utilizado</th>
                <td className="metric">{cenario.hspKwhM2Dia} h/dia</td>
              </tr>
              <tr>
                <th>Origem do HSP</th>
                <td>{cenario.hspFonte}</td>
              </tr>
              <tr>
                <th>Armazenamento</th>
                <td>
                  {cenario.armazenamento
                    ? `Com baterias (autonomia de ${cenario.autonomiaHoras} h)`
                    : 'Sem baterias'}
                </td>
              </tr>
              <tr>
                <th>Custo de baterias</th>
                <td className="metric">R$ {Number(cenario.custoBateriaBrl).toFixed(2).replace('.', ',')}</td>
              </tr>
              <tr><th>Equipamentos</th><td className="metric">R$ {Number(cenario.custoEquipamentosBrl).toFixed(2).replace('.', ',')}</td></tr>
              <tr><th>Módulos / inversor</th><td className="metric">R$ {(Number(cenario.custoPaineisBrl) + Number(cenario.custoInversorBrl)).toFixed(2).replace('.', ',')}</td></tr>
              <tr><th>Estrutura / cabeamento / proteções / instalação</th><td className="metric">R$ {(Number(cenario.custoEstruturaBrl) + Number(cenario.custoCabeamentoBrl) + Number(cenario.custoProtecoesBrl) + Number(cenario.custoInstalacaoBrl)).toFixed(2).replace('.', ',')}</td></tr>
              {cenario.fontesCustosComplementares && <tr><th>Premissas dos custos complementares</th><td>{cenario.fontesCustosComplementares}</td></tr>}
              <tr><th>Total estimado da proposta</th><td className="metric">R$ {Number(cenario.custoTotalBrl).toFixed(2).replace('.', ',')}</td></tr>
              {cenario.armazenamento && (
                <>
                  <tr>
                    <th>Capacidade necessária estimada</th>
                    <td className="metric">{cenario.capacidadeBateriaNecessariaKwh ?? '—'} kWh</td>
                  </tr>
                  <tr>
                    <th>Bateria selecionada</th>
                    <td>
                      {dadosBaterias.baterias.find((b) => b.id === cenario.bateriaId)
                        ? `${dadosBaterias.baterias.find((b) => b.id === cenario.bateriaId).fabricante} ${dadosBaterias.baterias.find((b) => b.id === cenario.bateriaId).modelo}`
                        : 'Seleção pendente'}
                    </td>
                  </tr>
                  <tr>
                    <th>Quantidade</th>
                    <td className="metric">{cenario.quantidadeBaterias ?? '—'}</td>
                  </tr>
                  <tr>
                    <th>Capacidade instalada</th>
                    <td className="metric">{cenario.capacidadeBateriaInstaladaKwh ?? '—'} kWh</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <button className="btn-secondary btn-inline" onClick={carregarLogs}>
            {logs ? 'Atualizar memória de cálculo' : 'Ver memória de cálculo'}
          </button>
          <button className="btn-secondary btn-inline" onClick={() => window.print()}>Imprimir / salvar proposta em PDF</button>
          {logs && (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Fórmula</th>
                  <th>Entradas</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                    <td>{l.formula}</td>
                    <td>{Object.entries(l.entradas).map(([chave, valor]) => `${chave} = ${valor}`).join('; ')}</td>
                    <td className="metric">
                      {l.resultado} {l.unidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn-secondary btn-inline" onClick={() => {
            setConsumoManual(String(cenario.consumoReferenciaKwh));
            setPercentual(String(cenario.percentualAtendimento));
            setCidade(cenario.cidade);
            setUf(cenario.uf);
            setHspManual(cenario.hspOrigem === 'manual' ? String(cenario.hspKwhM2Dia || '') : '');
            setComArmazenamento(cenario.armazenamento);
            setAutonomia(cenario.autonomiaHoras ? String(cenario.autonomiaHoras) : '');
            setBateriaId(cenario.bateriaId ? String(cenario.bateriaId) : '');
            setPainelId(cenario.painelId ? String(cenario.painelId) : '');
            setInversorId(cenario.inversorId ? String(cenario.inversorId) : '');
            setEficienciaSistema(String(cenario.eficienciaSistema || 0.75));
            setDiasReferencia(String(cenario.diasReferencia || 30));
            setCustosExtras({ custoEstruturaBrl: String(cenario.custoEstruturaBrl), custoCabeamentoBrl: String(cenario.custoCabeamentoBrl), custoProtecoesBrl: String(cenario.custoProtecoesBrl), custoInstalacaoBrl: String(cenario.custoInstalacaoBrl), fontesCustosComplementares: cenario.fontesCustosComplementares || '' });
            setCenarioEditandoId(cenario.id);
            setCenario(null);
          }}>
            Editar cenário
          </button>
        </div>
      )}
    </div>
  );
}

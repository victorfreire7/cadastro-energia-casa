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

// PB05 — padrões/limites de η e D (o backend devolve os mesmos valores em `parametrosPotencia`)
const PARAMS_POTENCIA_PADRAO = {
  eta: { padrao: 0.8, min: 0.5, max: 0.95, fonte: '' },
  dias: { padrao: 30, min: 28, max: 31 }
};

// PB05 — P_FV = E_FV / (HSP × D × η); retorna null se algum parâmetro for inválido (sem divisão por zero)
function calcularPotenciaFvLocal(energia, hsp, dias, eta) {
  if (![energia, hsp, dias, eta].every((v) => Number.isFinite(v) && v > 0)) return null;
  return Number((energia / (hsp * dias * eta)).toFixed(3));
}

function validarEtaLocal(texto, { min, max }) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'o fator de desempenho deve ser um número';
  const numero = Number(valor);
  if (numero < min || numero > max) return `o fator de desempenho deve estar entre ${min} e ${max}`;
  return '';
}

function validarDiasLocal(texto, { min, max }) {
  const valor = texto.trim();
  if (valor === '') return '';
  if (!/^\d+$/.test(valor)) return 'os dias devem ser um número inteiro';
  const numero = Number(valor);
  if (numero < min || numero > max) return `os dias devem estar entre ${min} e ${max}`;
  return '';
}

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

// PB08 — comparação P_instalada × P_FV; alerta só quando há folga/déficit relevante
function ComparacaoPotencia({ comparacao }) {
  if (!comparacao) return null;
  const sinal = comparacao.diferencaKwp > 0 ? '+' : '';
  return (
    <>
      <p className="imovel-meta">
        P_instalada {comparacao.potenciaInstaladaKwp} kWp × P_FV {comparacao.potenciaFvKwp} kWp: diferença de {sinal}
        {comparacao.diferencaKwp} kWp ({sinal}
        {comparacao.desvioPct}%).
      </p>
      {comparacao.mensagem && (
        <div className="error-message" role="alert">
          {comparacao.mensagem}
        </div>
      )}
    </>
  );
}

const ETAPA_ENTRADAS = {
  E_FV: (e) => `C_m = ${e.C_m_kWh_mes} kWh/mês; f = ${e.f_percentual}%`,
  P_FV: (e) => `E_FV = ${e.E_FV_kWh_mes} kWh/mês; HSP = ${e.HSP_h_dia} h/dia; D = ${e.D_dias}; η = ${e.eta}`,
  N_MODULOS: (e) => `P_FV = ${e.P_FV_kWp} kWp; P_módulo = ${e.P_modulo_Wp} Wp (${e.modulo})`,
  P_INSTALADA: (e) => `N = ${e.N}; P_módulo = ${e.P_modulo_Wp} Wp; desvio vs P_FV = ${e.desvio_pct}%`
};

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
  const [moduloId, setModuloId] = useState(''); // '' = seleção automática (menor custo)
  const [opcoesModulos, setOpcoesModulos] = useState(null);
  const [etaTexto, setEtaTexto] = useState('');
  const [diasTexto, setDiasTexto] = useState('');

  // PB01 task 2 — lista de imóveis para seleção
  useEffect(() => {
    api
      .get('/imoveis')
      .then(({ data }) => setImoveis(data))
      .catch(() => setErro('não foi possível carregar seus imóveis'))
      .finally(() => !imovelId && setCarregando(false));
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
    setEtaTexto('');
    setDiasTexto('');
    setModuloId('');
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

  // PB05 — η e D (vazio = padrão); só usuário avançado altera
  const paramsPotencia = referencia?.parametrosPotencia || PARAMS_POTENCIA_PADRAO;
  const erroEta = validarEtaLocal(etaTexto, paramsPotencia.eta);
  const erroDias = validarDiasLocal(diasTexto, paramsPotencia.dias);
  const etaEfetivo = etaTexto.trim() !== '' && !erroEta ? Number(etaTexto.replace(',', '.')) : paramsPotencia.eta.padrao;
  const diasEfetivo = diasTexto.trim() !== '' && !erroDias ? Number(diasTexto) : paramsPotencia.dias.padrao;
  const potenciaFv = calcularPotenciaFvLocal(energiaFv, hspEfetivo, diasEfetivo, etaEfetivo);

  // PB07/PB08 — opções de módulo (N, P_instalada, custo e alerta) calculadas pelo backend
  useEffect(() => {
    if (potenciaFv === null) {
      setOpcoesModulos(null);
      return;
    }
    api
      .get('/dimensionamento/modulos', { params: { potenciaFvKwp: potenciaFv } })
      .then(({ data }) => setOpcoesModulos(data))
      .catch(() => setOpcoesModulos(null));
  }, [potenciaFv]);

  const moduloEscolhido = opcoesModulos
    ? opcoesModulos.opcoes.find((o) => o.moduloId === (moduloId ? Number(moduloId) : opcoesModulos.padraoId))
    : null;

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
    if (erroEta || erroDias) {
      setErro(erroEta || erroDias);
      return;
    }

    setSalvando(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/cenarios`, {
        cidade,
        uf,
        percentualAtendimento: percentual.trim().replace(',', '.'),
        ...(manualValido && { consumoReferenciaKwh: manualNumero }),
        ...(hspManualValido && { hspKwhM2Dia: hspEfetivo }),
        ...(etaTexto.trim() !== '' && { fatorDesempenho: etaEfetivo }),
        ...(diasTexto.trim() !== '' && { diasConsiderados: diasEfetivo }),
        ...(moduloId && { moduloId: Number(moduloId) })
      });
      setCenario(data);
      setLogs(null);
    } catch (err) {
      setErro(err.response?.data?.message || 'não foi possível salvar o cenário');
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
      <p className="imovel-meta">Passo 1 — consumo de referência, localização, HSP, percentual de atendimento e potência FV necessária</p>

      {erro && <div className="error-message">{erro}</div>}

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

      {imovelId && carregando && <p>Carregando...</p>}

      {referencia && !carregando && !cenario && (
        <form onSubmit={handleSubmit}>
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

          <h2 className="section-title">Potência FV necessária (P_FV)</h2>
          {potenciaFv !== null ? (
            <>
              <p className="metric total-consumo">{potenciaFv} kWp</p>
              <p className="imovel-meta">
                P_FV = E_FV / (HSP × D × η) = {energiaFv} / ({hspEfetivo} × {diasEfetivo} × {etaEfetivo})
              </p>
            </>
          ) : (
            <p className="imovel-meta">
              Defina consumo, percentual e HSP válidos para calcular a potência necessária.
            </p>
          )}

          <h2 className="section-title">Módulo fotovoltaico e quantidade (N)</h2>
          {opcoesModulos ? (
            <>
              <div className="field">
                <label htmlFor="modulo">Módulo</label>
                <select id="modulo" value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
                  <option value="">Automático — menor custo ({opcoesModulos.opcoes.find((o) => o.moduloId === opcoesModulos.padraoId)?.modelo})</option>
                  {opcoesModulos.opcoes.map((o) => (
                    <option key={o.moduloId} value={o.moduloId}>
                      {o.fabricante} {o.modelo} — {o.potenciaWp} Wp
                    </option>
                  ))}
                </select>
              </div>
              {moduloEscolhido && (
                <>
                  <p className="metric total-consumo">{moduloEscolhido.quantidade} módulos</p>
                  <p className="imovel-meta">
                    N = ⌈(P_FV × 1000) / P_módulo⌉ = ⌈({potenciaFv} × 1000) / {moduloEscolhido.potenciaWp}⌉
                  </p>
                  <h2 className="section-title">Potência instalada</h2>
                  <p className="metric total-consumo">{moduloEscolhido.potenciaInstaladaKwp} kWp</p>
                  <p className="imovel-meta">
                    P_instalada = (N × P_módulo) / 1000 = ({moduloEscolhido.quantidade} × {moduloEscolhido.potenciaWp}) / 1000
                  </p>
                  <ComparacaoPotencia comparacao={moduloEscolhido.comparacao} />
                </>
              )}
              <table className="table">
                <thead>
                  <tr>
                    <th>Módulo</th>
                    <th>Potência</th>
                    <th>N</th>
                    <th>P_instalada</th>
                    <th>Desvio</th>
                    <th>Custo dos módulos</th>
                  </tr>
                </thead>
                <tbody>
                  {opcoesModulos.opcoes.map((o) => (
                    <tr key={o.moduloId}>
                      <td>
                        {o.fabricante} {o.modelo}
                      </td>
                      <td>{o.potenciaWp} Wp</td>
                      <td className="metric">{o.quantidade}</td>
                      <td className="metric">{o.potenciaInstaladaKwp} kWp</td>
                      <td>
                        {o.comparacao.desvioPct > 0 ? '+' : ''}
                        {o.comparacao.desvioPct}%
                      </td>
                      <td>R$ {o.custoModulosBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="imovel-meta">Calcule a potência FV necessária para listar os módulos.</p>
          )}

          <details className="avancado">
            <summary>Configurações avançadas do cálculo (η e dias)</summary>
            <div className="field">
              <label htmlFor="eta">
                Fator de desempenho η ({paramsPotencia.eta.min} a {paramsPotencia.eta.max}) — padrão{' '}
                {paramsPotencia.eta.padrao}
              </label>
              <input
                id="eta"
                type="number"
                step="any"
                min={paramsPotencia.eta.min}
                max={paramsPotencia.eta.max}
                placeholder={String(paramsPotencia.eta.padrao)}
                value={etaTexto}
                onChange={(e) => setEtaTexto(e.target.value)}
                aria-invalid={erroEta ? 'true' : 'false'}
              />
              {erroEta && <div className="field-error">{erroEta}</div>}
              {paramsPotencia.eta.fonte && <div className="imovel-meta">Fonte do padrão: {paramsPotencia.eta.fonte}.</div>}
            </div>
            <div className="field">
              <label htmlFor="dias">
                Dias considerados D ({paramsPotencia.dias.min} a {paramsPotencia.dias.max}) — padrão{' '}
                {paramsPotencia.dias.padrao}
              </label>
              <input
                id="dias"
                type="number"
                step="1"
                min={paramsPotencia.dias.min}
                max={paramsPotencia.dias.max}
                placeholder={String(paramsPotencia.dias.padrao)}
                value={diasTexto}
                onChange={(e) => setDiasTexto(e.target.value)}
                aria-invalid={erroDias ? 'true' : 'false'}
              />
              {erroDias && <div className="field-error">{erroDias}</div>}
            </div>
          </details>

          <button
            className="btn-primary"
            type="submit"
            disabled={salvando || semReferencia || semHsp || !!erroPercentual || !!erroHsp || !!erroEta || !!erroDias}
          >
            {salvando ? 'Salvando...' : 'Salvar cenário e continuar'}
          </button>
          {semReferencia && (
            <p className="imovel-meta">Defina um consumo de referência para avançar.</p>
          )}
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
                <th>Potência FV necessária (P_FV)</th>
                <td className="metric">{cenario.potenciaFvKwp} kWp</td>
              </tr>
              <tr>
                <th>Módulo selecionado</th>
                <td>
                  {cenario.moduloFabricante} {cenario.moduloModelo} ({cenario.moduloPotenciaWp} Wp)
                </td>
              </tr>
              <tr>
                <th>Quantidade de módulos (N)</th>
                <td className="metric">{cenario.quantidadeModulos}</td>
              </tr>
              <tr>
                <th>Potência instalada</th>
                <td className="metric">{cenario.potenciaInstaladaKwp} kWp</td>
              </tr>
              <tr>
                <th>Fator de desempenho (η) / dias (D)</th>
                <td>
                  {cenario.fatorDesempenho} / {cenario.diasConsiderados}
                </td>
              </tr>
              <tr>
                <th>HSP utilizado</th>
                <td className="metric">{cenario.hspKwhM2Dia} h/dia</td>
              </tr>
              <tr>
                <th>Origem do HSP</th>
                <td>{cenario.hspFonte}</td>
              </tr>
            </tbody>
          </table>
          <ComparacaoPotencia comparacao={cenario.comparacaoPotencia} />
          <button className="btn-secondary btn-inline" onClick={carregarLogs}>
            {logs ? 'Atualizar memória de cálculo' : 'Ver memória de cálculo'}
          </button>
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
                    <td>
                      {(ETAPA_ENTRADAS[l.etapa] || (() => ''))(l.entradas)}
                    </td>
                    <td className="metric">
                      {l.resultado} {l.unidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn-secondary btn-inline" onClick={() => setCenario(null)}>
            Editar parâmetros
          </button>
        </div>
      )}
    </div>
  );
}

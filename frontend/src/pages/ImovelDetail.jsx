import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';

export default function ImovelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [imovel, setImovel] = useState(null);
  const [consumo, setConsumo] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(false);
  const [formEdicao, setFormEdicao] = useState({ endereco: '', tipo: '', status: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    carregarTudo();
  }, [id]);

  async function carregarTudo() {
    try {
      const [imoveisResp, consumoResp, historicoResp] = await Promise.all([
        api.get('/imoveis'),
        api.get(`/imoveis/${id}/consumo`),
        api.get(`/imoveis/${id}/historico`)
      ]);
      const encontrado = imoveisResp.data.find((i) => i.id === Number(id));
      setImovel(encontrado);
      setFormEdicao({
        endereco: encontrado.endereco,
        tipo: encontrado.tipo,
        status: encontrado.status
      });
      setConsumo(consumoResp.data);
      setHistorico(historicoResp.data);
    } catch (err) {
      setErro('não foi possível carregar os dados do imóvel');
    }
  }

  async function registrarConsumo() {
    try {
      await api.post(`/imoveis/${id}/consumo`);
      carregarTudo();
    } catch (err) {
      setErro('não foi possível registrar o consumo deste mês');
    }
  }

  async function excluirImovel() {
    if (!window.confirm('Excluir este imóvel e seus eletrodomésticos?')) return;
    try {
      await api.delete(`/imoveis/${id}`);
      navigate('/dashboard');
    } catch (err) {
      setErro('não foi possível excluir o imóvel');
    }
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.put(`/imoveis/${id}`, formEdicao);
      setEditando(false);
      carregarTudo();
    } catch (err) {
      setErro('não foi possível salvar as alterações');
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="dashboard error-message">{erro}</div>;
  if (!imovel || !consumo) return <div className="dashboard">Carregando...</div>;

  return (
    <div className="dashboard">
      <Link to="/dashboard" className="back-link">
        ← Voltar
      </Link>

      {editando ? (
        <form onSubmit={salvarEdicao}>
          <h1>Editar imóvel</h1>

          <div className="field">
            <label htmlFor="endereco">Endereço</label>
            <input
              id="endereco"
              value={formEdicao.endereco}
              onChange={(e) => setFormEdicao({ ...formEdicao, endereco: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="tipo">Tipo</label>
            <select
              id="tipo"
              value={formEdicao.tipo}
              onChange={(e) => setFormEdicao({ ...formEdicao, tipo: e.target.value })}
            >
              <option value="residencial">Residencial</option>
              <option value="comercial">Comercial</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={formEdicao.status}
              onChange={(e) => setFormEdicao({ ...formEdicao, status: e.target.value })}
            >
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </div>

          <button className="btn-primary btn-inline" type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
          <button
            className="btn-secondary btn-inline"
            type="button"
            onClick={() => setEditando(false)}
          >
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <div className="dashboard-header">
            <h1>{imovel.endereco}</h1>
            <div>
              <button className="btn-secondary btn-inline" onClick={() => setEditando(true)}>
                Editar
              </button>
              <button className="btn-secondary" onClick={excluirImovel}>
                Excluir imóvel
              </button>
            </div>
          </div>
          <p className="imovel-meta">
            {imovel.tipo} · {imovel.status}
          </p>
        </>
      )}

      <h2 className="section-title">Eletrodomésticos</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Potência (W)</th>
            <th>Qtd</th>
            <th>Horas/dia</th>
          </tr>
        </thead>
        <tbody>
          {imovel.eletrodomesticos.map((e) => (
            <tr key={e.id}>
              <td>{e.nome}</td>
              <td className="metric">{e.potenciaW}</td>
              <td className="metric">{e.quantidade}</td>
              <td className="metric">{e.horasDia}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title">Consumo estimado</h2>
      <p className="metric total-consumo">{consumo.totalKwhMes} kWh/mês</p>
      <button className="btn-primary btn-inline" onClick={registrarConsumo}>
        Registrar leitura deste mês
      </button>

      <h2 className="section-title">Histórico</h2>
      {historico.length === 0 ? (
        <p className="empty-state">Nenhuma leitura registrada ainda.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Consumo (kWh)</th>
              <th>Variação</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((h) => (
              <tr key={h.id}>
                <td>{h.mesReferencia}</td>
                <td className="metric">{h.consumoTotalKwh}</td>
                <td className="metric">
                  {h.variacaoKwh === null
                    ? '—'
                    : `${h.variacaoKwh > 0 ? '+' : ''}${h.variacaoKwh}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

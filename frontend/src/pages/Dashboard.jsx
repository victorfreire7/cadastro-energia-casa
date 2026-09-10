import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const [imoveis, setImoveis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setCarregando(true);
    try {
      const { data } = await api.get('/imoveis');
      setImoveis(data);
    } catch (err) {
      setErro('não foi possível carregar seus imóveis');
    } finally {
      setCarregando(false);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Seus imóveis</h1>
        <button className="btn-secondary" onClick={handleLogout}>
          Sair
        </button>
      </div>

      <Link className="btn-primary btn-inline" to="/imoveis/novo">
        + Cadastrar imóvel
      </Link>

      {erro && <div className="error-message">{erro}</div>}

      {carregando ? (
        <p>Carregando...</p>
      ) : imoveis.length === 0 ? (
        <p className="empty-state">Nenhum imóvel cadastrado ainda. Cadastre o primeiro acima.</p>
      ) : (
        <ul className="imovel-list">
          {imoveis.map((imovel) => (
            <li key={imovel.id} className="imovel-card">
              <div>
                <strong>{imovel.endereco}</strong>
                <div className="imovel-meta">
                  {imovel.tipo} · {imovel.status} · {imovel.eletrodomesticos.length} eletrodomésticos
                </div>
              </div>
              <Link to={`/imoveis/${imovel.id}`}>Ver detalhes</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


document.addEventListener('DOMContentLoaded', () => {
    const buscarBtn = document.getElementById('buscar-btn');
    const salvarBtn = document.getElementById('salvar-monitoramento-btn');
    const filtroInput = document.getElementById('filtro-input');
    const listaResultados = document.getElementById('lista-resultados');
    const statusBusca = document.getElementById('status-busca');
    const aiToggle = document.getElementById('ai-toggle');
    const monitoramentoAtual = document.getElementById('monitoramento-atual');

    // Função para buscar e exibir o status do monitoramento atual
    async function carregarStatusMonitoramento() {
        try {
            monitoramentoAtual.textContent = 'Carregando filtro atual...';
            const response = await fetch('/status-monitoramento');
            const config = await response.json();
            monitoramentoAtual.textContent = `Filtro ativo: "${config.pedidoOriginal}"`;
        } catch (error) {
            monitoramentoAtual.textContent = 'Não foi possível carregar o filtro de monitoramento.';
        }
    }

    // Carrega o status assim que a página abre
    carregarStatusMonitoramento();

    // Evento do botão "Buscar Agora"
    buscarBtn.addEventListener('click', async () => {
        const pedido = filtroInput.value;
        const usarIA = aiToggle.checked;

        if (usarIA && !pedido) {
            statusBusca.textContent = 'Por favor, digite sua busca para usar a IA.';
            return;
        }
        
        statusBusca.textContent = usarIA ? 'Consultando a IA e iniciando a busca... Este processo pode levar alguns minutos.' : 'Iniciando busca padrão...';
        listaResultados.innerHTML = '';

        try {
            const response = await fetch('/buscar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedido: pedido, usarIA: usarIA })
            });

            if (!response.ok) {
                const erro = await response.json();
                throw new Error(erro.message || 'Ocorreu um erro no servidor.');
            }

            const licitacoes = await response.json();

            if (licitacoes.length === 0) {
                statusBusca.textContent = 'Nenhuma licitação encontrada com os filtros aplicados.';
                return;
            }

            statusBusca.textContent = `Busca concluída! ${licitacoes.length} licitações encontradas e analisadas.`;
            
            licitacoes.forEach(lic => {
                const li = document.createElement('li');
                li.className = 'resultado-item';
                
                let analiseHtml = '';
                
                if (lic.relevancia === 'Erro') {
                    li.style.borderColor = '#e57373'; // Borda vermelha para erro
                    analiseHtml = `<div class="analise-ia erro-analise">
                        <strong>Análise IA:</strong> <em>${lic.justificativa}</em>
                    </div>`;
                } else if (lic.relevancia || lic.relevancia === 0) {
                     if (lic.relevancia >= 8) {
                        li.style.borderColor = '#66bb6a'; // Verde
                    } else if (lic.relevancia >= 5) {
                        li.style.borderColor = '#ffa726'; // Laranja
                    }
                    analiseHtml = `<div class="analise-ia">
                        <strong>Análise IA:</strong> Relevância <strong>${lic.relevancia}/10</strong> - <em>${lic.justificativa || 'Sem detalhes.'}</em>
                    </div>`;
                }

                li.innerHTML = `
                    <div class="resultado-header">
                        <span><strong>Fonte:</strong> ${lic.fonte}</span>
                        <span><strong>Número/Modalidade:</strong> ${lic.numero || lic.modalidade.match(/Nº \d+\/\d+/)?.[0] || 'N/A'}</span>
                    </div>
                    <div class="resultado-body">
                        <p><strong>Órgão:</strong> ${lic.orgao || lic.empresa}</p>
                        <p><strong>Objeto:</strong> ${lic.objeto}</p>
                        <p><strong>Abertura/Fim:</strong> ${lic.dataAbertura || lic.dataFim || 'N/A'}</p>
                        ${analiseHtml}
                    </div>
                `;
                listaResultados.appendChild(li);
            });

        } catch (error) {
            console.error('Erro ao buscar licitações:', error);
            statusBusca.textContent = `Erro: ${error.message}`;
        }
    });

    
    salvarBtn.addEventListener('click', async () => {
        const pedido = filtroInput.value;

        if (!aiToggle.checked) {
            alert('Para definir um novo filtro de monitoramento, a busca por IA deve estar ativada.');
            return;
        }
        if (!pedido) {
            alert('Por favor, digite o filtro que deseja salvar para monitoramento.');
            return;
        }

        statusBusca.textContent = 'Usando a IA para criar e salvar o novo filtro de monitoramento...';
        
        try {
            const response = await fetch('/salvar-monitoramento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedido: pedido })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message);
            }

            alert('Sucesso! O novo filtro foi salvo e será usado nas próximas buscas automáticas.');
            carregarStatusMonitoramento();
            statusBusca.textContent = 'Novo filtro de monitoramento salvo!';

        } catch (error) {
            alert(`Erro ao salvar: ${error.message}`);
            statusBusca.textContent = 'Falha ao salvar o novo filtro.';
        }
    });
});
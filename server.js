

require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');

// CONFIGURAÇÃO CENTRALIZADA
const app = express();
const PORT = 3000;
const CONFIG_FILE_PATH = path.join(__dirname, 'monitor_config.json');

// Inicializa a IA para ser usada em todo o servidor
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// Importa e configura os robôs scrapers
const { buscarComprasNet } = require('./comprasNetScraper.js');
const { buscarPetronect } = require('./petronectScraper.js');
const scrapersAtivos = [
    buscarComprasNet,
    // buscarPetronect, // Deixe comentado para focar no ComprasNet
];

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Rota principal
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });


// FUNÇÕES DE LÓGICA

async function gerarFiltros(pedido) {
    console.log(`\n[IA] Traduzindo pedido: "${pedido}"`);
    const prompt = `Você é um assistente especialista em traduzir pedidos em linguagem natural para filtros de busca. Sua tarefa é converter o "Pedido do Usuário" em um objeto JSON com as chaves: "objeto", "uf", e "tipo". Regras: - "objeto": Extraia o principal produto ou serviço. - "uf": Extraia o estado e retorne a sigla de 2 letras (ex: São Paulo -> SP). Se não houver, use "". - "tipo": Retorne "servico" ou "material". Se ambíguo, use "servico". Pedido do Usuário: "${pedido}"`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const filtros = JSON.parse(text);
        console.log('[IA] ✅ Filtros gerados com sucesso:', filtros);
        return filtros;
    } catch (error) {
        console.error("[IA - Gerar Filtros] ❌ Erro:", error);
        throw new Error("Falha na geração de filtros pela IA.");
    }
}

async function analisarRelevancia(licitacoes, pedidoOriginal) {
    if (!licitacoes || licitacoes.length === 0) return licitacoes;
    console.log(`\n[Análise IA] Enviando ${licitacoes.length} licitações para análise de relevância...`);
    const listaParaAnalise = licitacoes.map((lic, index) => ({ id: index, objeto: lic.objeto }));
    const prompt = `Você é um analista de licitações sênior. O pedido original de um usuário foi: "${pedidoOriginal}". A seguir, uma lista de licitações encontradas. Sua tarefa é analisar cada uma e retornar um array de objetos JSON com os campos "id", "relevancia" (pontuação de 0 a 10) e "justificativa" (frase curta). Seja rigoroso. Se não tiver relação, dê nota baixa. Lista: ${JSON.stringify(listaParaAnalise)}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const analises = JSON.parse(text);
        console.log('[Análise IA] ✅ Análise de relevância concluída.');
        const licitacoesAnalisadas = licitacoes.map((lic, index) => {
            const analise = analises.find(a => a.id === index) || {};
            return { ...lic, relevancia: analise.relevancia, justificativa: analise.justificativa };
        });
        licitacoesAnalisadas.sort((a, b) => (b.relevancia || 0) - (a.relevancia || 0));
        return licitacoesAnalisadas;
    } catch (e) {
        console.error("[Análise IA] ❌ Erro ao analisar relevância:", e.message);
        return licitacoes.map(lic => ({ ...lic, relevancia: 'Erro', justificativa: 'A análise da IA falhou. Verifique o console do servidor.' }));
    }
}

async function enviarAlertaPorEmail(licitacoes, filtroUsado, tipoDeBusca) {
    console.log('[Email] Configurando o serviço de e-mail...');
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    let corpoHtml = `<h1>Alerta de Licitações</h1><p>Encontramos ${licitacoes.length} novas licitações para o filtro: <b>${filtroUsado}</b></p><ul>`;
    for (const lic of licitacoes) {
        corpoHtml += `<hr><li>
            <b>Fonte:</b> ${lic.fonte}<br>
            <b>Número/Modalidade:</b> ${lic.numero || lic.modalidade}<br>
            <b>Órgão:</b> ${lic.orgao || lic.empresa}<br>
            <b>Abertura/Fim:</b> ${lic.dataAbertura || lic.dataFim || 'N/A'}<br>
            <b>Objeto:</b> ${lic.objeto}<br>
            <b>Relevância (0-10):</b> ${lic.relevancia || 'N/A'}<br>
            <b>Justificativa:</b> ${lic.justificativa || 'N/A'}
        </li>`;
    }
    corpoHtml += '</ul>';
    const mailOptions = { from: `Alerta de Licitações <${process.env.EMAIL_USER}>`, to: process.env.EMAIL_USER, subject: `[${tipoDeBusca}] Alerta: ${licitacoes.length} Novas Licitações Encontradas!`, html: corpoHtml };
    try {
        await transporter.sendMail(mailOptions);
        console.log('[Email] ✅ Alerta por e-mail enviado com sucesso!');
    } catch (error) {
        console.error('[Email] ❌ Erro ao enviar e-mail:', error);
    }
}


// ROTAS DA API

app.post('/buscar', async (req, res) => {
    try {
        const { pedido, usarIA } = req.body;
        let filtros;
        let resultadoFinal;
        let tipoDeBusca = "Busca Manual";
        let pedidoOriginalParaAnalise = null;

        console.log(`\n--- NOVA BUSCA RECEBIDA (IA: ${usarIA}) ---`);

        if (usarIA) {
            tipoDeBusca = "Busca por IA";
            if (!pedido) return res.status(400).json({ message: 'O pedido de busca está vazio.' });
            filtros = await gerarFiltros(pedido);
            pedidoOriginalParaAnalise = pedido;
        } else {
            console.log('[Servidor] Usando filtros manuais/padrão.');
            filtros = { objeto: '', uf: 'RJ', tipo: 'servico' };
        }
        
        const buscaApenasHoje = (pedido || "").includes("hoje");
        const promessasDeBusca = scrapersAtivos.map(scraper => scraper(filtros, buscaApenasHoje));
        const resultadosIniciais = await Promise.all(promessasDeBusca);
        resultadoFinal = resultadosIniciais.flat();

        if (usarIA && resultadoFinal.length > 0) {
            resultadoFinal = await analisarRelevancia(resultadoFinal, pedidoOriginalParaAnalise);
        }
        
        console.log('--- BUSCA CONCLUÍDA ---');
        if (resultadoFinal.length > 0) {
            console.log(`Enviando ${resultadoFinal.length} resultados para o frontend.`);
            await enviarAlertaPorEmail(resultadoFinal, usarIA ? pedido : 'Busca Padrão', tipoDeBusca);
        } else {
            console.log('Nenhuma licitação encontrada.');
        }

        res.json(resultadoFinal);
    } catch (error) {
        console.error("Erro na rota /buscar:", error);
        res.status(500).json({ message: error.message || 'Erro interno no servidor.' });
    }
});

app.post('/salvar-monitoramento', async (req, res) => {
    try {
        const { pedido } = req.body;
        if (!pedido) return res.status(400).json({ message: 'O pedido para monitoramento está vazio.' });
        console.log(`[Servidor] Recebido novo pedido de monitoramento: "${pedido}"`);
        const filtros = await gerarFiltros(pedido);
        const novaConfig = { pedidoOriginal: pedido, filtros: filtros };
        await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(novaConfig, null, 2));
        console.log('[Servidor] ✅ Novo filtro de monitoramento salvo com sucesso!');
        res.json({ message: 'Filtro de monitoramento atualizado!', novaConfig });
    } catch (error) {
        console.error("Erro ao salvar monitoramento:", error);
        res.status(500).json({ message: 'Erro ao salvar o filtro.' });
    }
});

app.get('/status-monitoramento', async (req, res) => {
    try {
        const configData = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        res.json(JSON.parse(configData));
    } catch (error) {
        res.status(500).json({ message: 'Erro ao ler configuração.' });
    }
});


async function tarefaAgendada() {
    console.log('\n--- [CRON] EXECUÇÃO AGENDADA INICIADA ---');
    try {
        const configData = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        const config = JSON.parse(configData);
        console.log('[CRON] Usando filtros de monitoramento salvos:', config);
        
        const promessasDeBusca = scrapersAtivos.map(scraper => scraper(config.filtros, false));
        const resultadosIniciais = await Promise.all(promessasDeBusca);
        let resultadoFinal = resultadosIniciais.flat();

        if (resultadoFinal.length > 0) {
            resultadoFinal = await analisarRelevancia(resultadoFinal, config.pedidoOriginal);
            await enviarAlertaPorEmail(resultadoFinal, config.pedidoOriginal, "Monitoramento Agendado");
        } else {
            console.log("[CRON] Nenhuma licitação encontrada na busca agendada.");
        }
    } catch (error) {
        console.error('[CRON] ❌ Falha ao executar a tarefa agendada:', error);
    }
}
cron.schedule('0 8,14,20 * * *', tarefaAgendada, { timezone: "America/Sao_Paulo" });

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Monitoramento automático configurado.`);
});
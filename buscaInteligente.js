
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const querystring = require('querystring');

const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

async function gerarFiltrosComIA(pedido) {
    console.log(`\n[ETAPA 1: IA] Recebido pedido do usuário: "${pedido}"`);
    const prompt = `Você é um assistente especialista em traduzir pedidos em linguagem natural para filtros de busca no portal ComprasNet do Brasil. Sua tarefa é converter o "Pedido do Usuário" em um objeto JSON. O objeto deve conter as chaves: "objeto", "uf", "codModalidade" e "tipo". Regras: - "objeto": Extraia o principal produto ou serviço. - "uf": Extraia o estado e retorne a sigla de 2 letras (ex: São Paulo -> SP). Se não houver, use "". - "codModalidade": Se não especificado, retorne ['1','2','3','20','5','99']. - "tipo": Retorne "servico" ou "material". Se ambíguo, use "servico". Códigos: "Pregão Eletrônico": "5", "Concorrência": "3", "Tomada de Preço": "2", "Convite": "1", "Concurso": "4", "Leilão": "6". Pedido do Usuário: "${pedido}"`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const filtros = JSON.parse(jsonText);
        console.log('[ETAPA 1: IA] ✅ Filtros gerados com sucesso:', filtros);
        return filtros;
    } catch (error) {
        console.error("[ETAPA 1: IA] ❌ Erro ao gerar filtros:", error);
        return null;
    }
}


const URL_BASE = 'http://comprasnet.gov.br/ConsultaLicitacoes/';
const URL_FILTRO = `${URL_BASE}ConsLicitacao_Filtro.asp`;
const URL_ACAO = `${URL_BASE}ConsLicitacao_Relacao.asp`;

const headersDoNavegador = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'max-age=0',
    'referer': URL_FILTRO, 'origin': 'http://comprasnet.gov.br',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

function construirCorpoRequisicao(data) {
    const corpo = [];
    for (const chave in data) {
        const valor = data[chave];
        if (Array.isArray(valor)) {
            valor.forEach(v => { corpo.push(`${encodeURIComponent(chave)}=${encodeURIComponent(v)}`); });
        } else {
            corpo.push(`${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`);
        }
    }
    return corpo.join('&');
}

function extrairDadosDaPagina(html) {
    const $ = cheerio.load(html);
    const licitacoesPagina = [];
    $('tr.tex3').each((i, el) => {
        const celula = $(el).find('td[style="padding:10px"]');
        if (celula.length > 0) {
            const textoCompleto = celula.text();
            const htmlCompleto = celula.html();
            const orgao = textoCompleto.split('Código da UASG:')[0].trim().replace(/\s+/g, ' ');
            const uasg = textoCompleto.match(/Código da UASG: (\d+)/)?.[1] || null;
            const modalidade = textoCompleto.match(/(Pregão Eletrônico Nº \d+\/\d+)|(Concorrência Nº \d+\/\d+)|(Tomada de Preços Nº \d+\/\d+)/)?.[0] || 'Modalidade não encontrada';
            let objeto = htmlCompleto.match(/<b>Objeto:<\/b>&nbsp;(?:Objeto: )?(.*?)<br>/)?.[1] || 'Objeto não encontrado';
            objeto = objeto.trim().replace(/<br>/g, ' ');
            const aberturaProposta = textoCompleto.match(/Abertura da Proposta:.*?em (\d{2}\/\d{2}\/\d{4}) às (\d{2}:\d{2}Hs)/);
            licitacoesPagina.push({
                orgao, uasg, modalidade: modalidade.replace(/\s+/g, ' '), objeto,
                dataAbertura: aberturaProposta ? aberturaProposta[1] : null,
                horaAbertura: aberturaProposta ? aberturaProposta[2] : null,
            });
        }
    });
    return licitacoesPagina;
}

async function buscarTodasAsLicitacoes(filtros, buscaHoje) {
    if (!filtros) { return []; }
    console.log('\n[ETAPA 2: Scraper] Iniciando busca no ComprasNet...');
    const cookieJar = new CookieJar();
    const client = wrapper(axios.create({ jar: cookieJar }));

    try {
        await client.get(URL_FILTRO, { headers: headersDoNavegador });
        console.log('[ETAPA 2: Scraper] ✅ Cookie de sessão obtido.');

        const hoje = new Date();
        const dataFimFormatada = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
        let dataInicioFormatada;
        if (buscaHoje) {
            dataInicioFormatada = dataFimFormatada;
        } else {
            const dataInicio = new Date(); dataInicio.setDate(hoje.getDate() - 14);
            dataInicioFormatada = `${String(dataInicio.getDate()).padStart(2, '0')}/${String(dataInicio.getMonth() + 1).padStart(2, '0')}/${dataInicio.getFullYear()}`;
        }
        console.log(`[ETAPA 2: Scraper] Período de busca: de ${dataInicioFormatada} a ${dataFimFormatada}.`);

        const objetoDaBusca = (filtros.objeto || '').toLowerCase().replace('ç', 'c');
        const formData = {
            numprp: '', dt_publ_ini: dataInicioFormatada, dt_publ_fim: dataFimFormatada,
            txtObjeto: objetoDaBusca,
            chkModalidade: filtros.codModalidade || ['1', '2', '3', '20', '5', '99'],
            chkTodos: '-1',
            chk_concor: ['31', '32', '41', '42', '49'], chk_concorTodos: '-1',
            chk_pregao: ['1', '2', '3', '4'], chk_pregaoTodos: '-1',
            chk_rdc: ['1', '2', '3', '4'], chk_rdcTodos: '-1',
            optTpPesqMat: filtros.tipo === 'servico' ? 'N' : (filtros.tipo === 'material' ? 'M' : ''),
            optTpPesqServ: filtros.tipo === 'servico' ? 'S' : (filtros.tipo === 'material' ? 'N' : ''),
            txtlstUasg: '', txtlstUf: filtros.uf || '', txtlstMunicipio: '', txtlstModalidade: '',
            txtlstTpPregao: '', txtlstConcorrencia: '', txtlstGrpMaterial: '',
            txtlstClasMaterial: '', txtlstMaterial: '', txtlstGrpServico: '',
            txtlstServico: '', Origem: 'F'
        };
        
        const dadosFormatados = construirCorpoRequisicao(formData);
        const bufferCodificado = iconv.encode(dadosFormatados, 'latin1');
        
        const responsePagina1 = await client.post(URL_ACAO, bufferCodificado, {
            headers: { ...headersDoNavegador, 'Content-Type': 'application/x-www-form-urlencoded' },
            responseType: 'arraybuffer',
        });
        const htmlPagina1 = iconv.decode(responsePagina1.data, 'iso-8859-1');

        const $ = cheerio.load(htmlPagina1);
        if ($('.mensagem').text().includes('Não existe licitação')) {
            console.log('[ETAPA 2: Scraper] ✅ Busca concluída. O site informou que não há resultados para estes filtros.');
            return [];
        }
        
        let todasAsLicitacoes = extrairDadosDaPagina(htmlPagina1);
        const textoPaginacao = $('td.td_titulo_campo center').text();
        const totalLicitacoesMatch = textoPaginacao.match(/de (\d+)/);
        
        if (totalLicitacoesMatch) {
            const totalPaginas = Math.ceil(parseInt(totalLicitacoesMatch[1], 10) / 10);
            if(totalPaginas > 1) {
                console.log(`[ETAPA 2: Scraper] Paginação detectada. Total de ${totalLicitacoesMatch[1]} licitações em ${totalPaginas} páginas.`);
                for (let i = 2; i <= totalPaginas; i++) {
                    console.log(`[ETAPA 2: Scraper] Buscando página ${i} de ${totalPaginas}...`);
                    const urlPagina = `${URL_ACAO}?${dadosFormatados}&numpag=${i}`;
                    const responsePagina = await client.get(urlPagina, { headers: headersDoNavegador, responseType: 'arraybuffer' });
                    const htmlPagina = iconv.decode(responsePagina.data, 'iso-8859-1');
                    todasAsLicitacoes.push(...extrairDadosDaPagina(htmlPagina));
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
        return todasAsLicitacoes;
    } catch (error) {
        console.error('[ETAPA 2: Scraper] ❌ Erro ao buscar licitações:', error.message);
        return [];
    }
}

async function iniciarBuscaInteligentePaginada(pedidoDoUsuario) {
    const filtros = await gerarFiltrosComIA(pedidoDoUsuario);
    const buscaApenasHoje = pedidoDoUsuario.includes("hoje");
    const resultado = await buscarTodasAsLicitacoes(filtros, buscaApenasHoje);
    console.log('\n--- RESULTADO FINAL DA BUSCA INTELIGENTE ---');
    if (resultado && resultado.length > 0) {
        console.log(`Sucesso! Total de ${resultado.length} licitações encontradas.`);
        console.log(resultado);
    } else {
        console.log('Nenhuma licitação encontrada.');
    }
}


const pedidoDoUsuario = "licitações de serviço de qualquer modalidade no rio de janeiro hoje";
iniciarBuscaInteligentePaginada(pedidoDoUsuario);
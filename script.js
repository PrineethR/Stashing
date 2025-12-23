import { GoogleGenAI, Type } from "@google/genai";
import { BlockType } from "./types.js";

/* --- STATE & DATA --- */
const DEFAULT_CHANNELS = [
    { id: 'c_inbox', title: 'Inbox', slug: 'inbox', createdAt: Date.now() },
    { id: 'c_design', title: 'Patterns', slug: 'patterns', vertical: 'Design', createdAt: Date.now() },
    { id: 'c_code', title: 'Snippets', slug: 'snippets', vertical: 'Code', createdAt: Date.now() },
];

let state = {
    blocks: [],
    channels: DEFAULT_CHANNELS,
    activeChannelId: 'c_inbox',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    editingBlockId: null // track if we are in edit mode
};

/* --- STORAGE --- */
const loadState = () => {
    const stored = localStorage.getItem('my_stash_v1');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            state = { ...state, ...parsed, apiKey: localStorage.getItem('gemini_api_key') || '', editingBlockId: null };
        } catch(e) { console.error("State load error", e); }
    }
};

const saveState = () => {
    const toSave = { ...state };
    delete toSave.apiKey;
    delete toSave.editingBlockId;
    localStorage.setItem('my_stash_v1', JSON.stringify(toSave));
};

/* --- AI SERVICE --- */
const getAI = () => {
    if (!state.apiKey) return null;
    return new GoogleGenAI({ apiKey: state.apiKey });
};

const analyzeContent = async (content, type) => {
    const ai = getAI();
    if (!ai) return { title: 'Untitled', summary: '', tags: [] };

    const textPreview = content.length > 5000 ? content.substring(0, 5000) : content;
    const prompt = `Analyze this ${type}:
    Content: ${textPreview}
    
    Return JSON with:
    1. title (short, max 6 words)
    2. summary (1 sentence)
    3. tags (array of 3-5 lowercase single words)`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                }
            }
        });
        return JSON.parse(response.text);
    } catch (e) {
        console.error("AI Error", e);
        return { title: 'Untitled', summary: 'Analysis failed or Key invalid.', tags: ['error'] };
    }
};

const findConnections = async (blocks) => {
    const ai = getAI();
    if (!ai) return "Please set your API Key in Settings first.";
    
    const context = blocks.slice(0, 20).map(b => `[${b.title || 'Untitled'}]: ${b.content.substring(0, 150)}`).join('\n---\n');
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Here is a set of notes/blocks:\n${context}\n\nTask: Find a hidden theme, interesting connection, or insight that links several of these items together. Be brief and insightful.`
        });
        return response.text;
    } catch(e) { 
        console.error(e);
        return "Could not generate connections. Check API Key."; 
    }
};

/* --- UI RENDERER --- */
const renderChannels = () => {
    const container = document.getElementById('channel-list');
    if (!container) return;

    container.innerHTML = '';

    // 'All Blocks' button
    const allBtn = document.createElement('button');
    allBtn.className = `w-full text-left px-3 py-2 text-sm font-bold uppercase border border-transparent transition-colors ${state.activeChannelId === null ? 'bg-neutral-800 text-white border-neutral-700' : 'text-neutral-500 hover:text-white'}`;
    allBtn.textContent = 'All Blocks';
    allBtn.onclick = () => app.setChannel(null);
    container.appendChild(allBtn);

    const groups = {};
    const general = [];
    state.channels.forEach(c => {
        if(c.vertical) {
            if(!groups[c.vertical]) groups[c.vertical] = [];
            groups[c.vertical].push(c);
        } else {
            general.push(c);
        }
    });

    const createChannelEl = (c) => {
        const div = document.createElement('div');
        div.className = "group flex items-center justify-between";
        
        // Main button
        const btn = document.createElement('button');
        btn.className = `flex-grow text-left px-3 py-1.5 text-sm truncate transition-colors ${state.activeChannelId === c.id ? 'text-white font-bold bg-neutral-800' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`;
        btn.textContent = c.title;
        btn.onclick = () => app.setChannel(c.id);
        
        // Actions container
        const actions = document.createElement('div');
        actions.className = "flex opacity-0 group-hover:opacity-100 transition-opacity";
        
        // Edit Btn
        const editBtn = document.createElement('button');
        editBtn.className = "text-neutral-600 hover:text-white p-1";
        editBtn.innerHTML = `<i data-lucide="pencil" class="w-3 h-3"></i>`;
        editBtn.onclick = (e) => { e.stopPropagation(); app.editChannel(c.id); };
        
        // Delete Btn
        const delBtn = document.createElement('button');
        delBtn.className = "text-neutral-600 hover:text-red-500 p-1";
        delBtn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3"></i>`;
        delBtn.onclick = (e) => { e.stopPropagation(); app.deleteChannel(c.id); };

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        
        div.appendChild(btn);
        div.appendChild(actions);
        return div;
    };

    if (general.length) {
        const label = document.createElement('div');
        label.className = "mt-6 mb-2 px-3 text-xs font-bold text-neutral-600 uppercase tracking-widest";
        label.textContent = "General";
        container.appendChild(label);
        general.forEach(c => container.appendChild(createChannelEl(c)));
    }

    Object.keys(groups).sort().forEach(vert => {
        const label = document.createElement('div');
        label.className = "mt-6 mb-2 px-3 text-xs font-bold text-neutral-600 uppercase tracking-widest flex justify-between group cursor-pointer";
        
        const textSpan = document.createElement('span');
        textSpan.textContent = vert;
        
        const actionsSpan = document.createElement('span');
        actionsSpan.className = "flex gap-2 opacity-0 group-hover:opacity-100";
        actionsSpan.innerHTML = `
            <i data-lucide="pencil" class="w-3 h-3 hover:text-white" title="Rename Group"></i>
            <i data-lucide="x" class="w-3 h-3 hover:text-red-500" title="Dissolve Group"></i>
        `;
        
        // Bind click events
        const pencil = actionsSpan.querySelector('i[data-lucide="pencil"]');
        const cross = actionsSpan.querySelector('i[data-lucide="x"]');
        
        pencil.onclick = (e) => { e.stopPropagation(); app.renameVertical(vert); };
        cross.onclick = (e) => { e.stopPropagation(); app.deleteVertical(vert); };

        label.appendChild(textSpan);
        label.appendChild(actionsSpan);
        container.appendChild(label);
        groups[vert].forEach(c => container.appendChild(createChannelEl(c)));
    });

    const form = document.createElement('form');
    form.className = "mt-6 px-2";
    form.onsubmit = app.createChannel;
    form.innerHTML = `<input type="text" name="name" placeholder="+ New Channel..." class="w-full text-sm px-3 py-2 bg-neutral-800 border border-neutral-700 text-white placeholder-neutral-600 focus:outline-none focus:border-white transition-colors">`;
    container.appendChild(form);

    lucide.createIcons();
};

const renderBlocks = () => {
    const grid = document.getElementById('block-grid');
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    
    let blocks = state.blocks.filter(b => {
        const matchesSearch = !searchVal || b.content.toLowerCase().includes(searchVal) || b.title?.toLowerCase().includes(searchVal);
        const matchesChannel = !state.activeChannelId || b.channelId === state.activeChannelId;
        return matchesSearch && matchesChannel;
    }).sort((a,b) => b.createdAt - a.createdAt);

    if (blocks.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-neutral-600 mt-20 font-mono">
            <div class="mb-4 inline-block p-4 bg-neutral-900 rounded-full"><i data-lucide="box" class="w-8 h-8 opacity-50"></i></div>
            <p>No blocks found.</p>
            <p class="text-xs mt-2 uppercase">Paste an image or click Add Block.</p>
        </div>`;
        lucide.createIcons();
        return;
    }

    grid.innerHTML = blocks.map(b => {
        const isImg = b.type === BlockType.IMAGE;
        const isLink = b.type === BlockType.LINK;
        const date = new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        let contentHtml = '';
        if (isImg) contentHtml = `<div class="border border-neutral-800 mb-4 bg-black/50"><img src="${b.content}" class="w-full object-contain max-h-[500px]" loading="lazy"></div>`;
        else if (isLink) contentHtml = `<a href="${b.content}" target="_blank" class="text-blue-400 hover:underline break-all font-mono text-sm block mb-2">${b.content}</a>`;
        else contentHtml = `<p class="whitespace-pre-wrap text-neutral-300 font-sans text-sm leading-relaxed line-clamp-[10]">${b.content}</p>`;

        return `
        <div class="break-inside-avoid mb-8 bg-neutral-900 border border-neutral-800 p-6 hover:border-neutral-500 transition-colors group relative shadow-sm">
            <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onclick="app.editBlock('${b.id}')" class="text-neutral-500 hover:text-white" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button onclick="app.copyBlock('${b.id}')" class="text-neutral-500 hover:text-white" title="Copy Content"><i data-lucide="copy" class="w-4 h-4"></i></button>
                <button onclick="app.deleteBlock('${b.id}')" class="text-neutral-500 hover:text-red-500" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
            
            <div class="flex gap-2 text-[10px] text-neutral-500 font-mono uppercase mb-4 tracking-wider">
                <span class="flex items-center gap-1"><i data-lucide="${isImg ? 'image' : isLink ? 'link' : 'type'}" class="w-3 h-3"></i> ${b.type}</span>
                <span>•</span>
                <span>${date}</span>
            </div>
            
            ${b.title ? `<h3 class="font-bold text-white text-lg mb-3 font-mono leading-tight">${b.title}</h3>` : ''}
            
            ${contentHtml}
            
            ${b.description ? `<div class="mt-4 text-xs text-neutral-500 italic font-serif border-l border-neutral-700 pl-3 leading-relaxed">${b.description}</div>` : ''}
            
            <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-neutral-800/50">
                ${b.tags.map(t => `<span class="text-[10px] px-2 py-1 border border-neutral-800 bg-neutral-950 text-neutral-400 font-mono uppercase hover:border-neutral-600 transition-colors cursor-default">#${t}</span>`).join('')}
            </div>
        </div>
        `;
    }).join('');
    lucide.createIcons();
};

/* --- MAIN APP CONTROLLER --- */
const app = {
    init: () => {
        loadState();
        renderChannels();
        renderBlocks();
        
        const loader = document.getElementById('loading-overlay');
        if(loader) loader.classList.add('hidden');

        document.getElementById('search-input').addEventListener('input', renderBlocks);
        
        document.getElementById('type-selector').addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') {
                document.querySelectorAll('#type-selector button').forEach(b => {
                    b.classList.remove('bg-white', 'text-black', 'border-white');
                    b.classList.add('text-neutral-500', 'border-transparent');
                });
                e.target.classList.remove('text-neutral-500', 'border-transparent');
                e.target.classList.add('bg-white', 'text-black', 'border-white');
                e.target.dataset.selected = "true";
                document.getElementById('add-content').focus();
            }
        });

        window.addEventListener('paste', (e) => {
            if (document.getElementById('add-modal').classList.contains('hidden')) {
                 const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                 for (const item of items) {
                    if (item.type.indexOf('image') !== -1) {
                        e.preventDefault();
                        const blob = item.getAsFile();
                        const reader = new FileReader();
                        reader.onload = (event) => app.openAddModal(event.target.result, BlockType.IMAGE);
                        reader.readAsDataURL(blob);
                        return; 
                    }
                 }
                 const text = e.clipboardData.getData('text');
                 if(text && !document.activeElement.tagName.match(/INPUT|TEXTAREA/)) {
                     app.openAddModal(text, text.match(/^http/) ? BlockType.LINK : BlockType.TEXT);
                 }
            } else {
                 const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                 for (const item of items) {
                    if (item.type.indexOf('image') !== -1) {
                        e.preventDefault();
                        const blob = item.getAsFile();
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            document.querySelector(`button[data-type="${BlockType.IMAGE}"]`).click();
                            document.getElementById('add-content').value = event.target.result;
                            document.getElementById('image-preview').src = event.target.result;
                            document.getElementById('image-preview-container').classList.remove('hidden');
                            document.getElementById('add-content').classList.add('hidden');
                        };
                        reader.readAsDataURL(blob);
                    }
                 }
            }
        });
    },

    setChannel: (id) => {
        state.activeChannelId = id;
        saveState();
        renderChannels();
        renderBlocks();
    },

    createChannel: (e) => {
        e.preventDefault();
        const input = e.target.name;
        const val = input.value.trim();
        if(!val) return;
        
        let vertical = undefined;
        let title = val;
        if(val.includes('/')) {
            const parts = val.split('/');
            vertical = parts[0].trim();
            title = parts[1].trim();
        }

        const newC = { id: `c_${Date.now()}`, title, vertical, slug: title.toLowerCase(), createdAt: Date.now() };
        state.channels.push(newC);
        state.activeChannelId = newC.id;
        input.value = '';
        saveState();
        renderChannels();
    },

    editChannel: (id) => {
        const c = state.channels.find(x => x.id === id);
        if(!c) return;
        
        const currentName = c.vertical ? `${c.vertical}/${c.title}` : c.title;
        const newName = prompt("Rename channel (use 'Group/Name' to categorize):", currentName);
        
        if(newName && newName !== currentName) {
             let vertical = undefined;
             let title = newName.trim();
             if(newName.includes('/')) {
                 const parts = newName.split('/');
                 vertical = parts[0].trim();
                 title = parts[1].trim();
             }
             c.title = title;
             c.vertical = vertical;
             c.slug = title.toLowerCase();
             saveState();
             renderChannels();
        }
    },

    deleteChannel: (id) => {
        if(confirm('Delete channel? Blocks inside will be removed.')) {
            state.channels = state.channels.filter(c => c.id !== id);
            state.blocks = state.blocks.filter(b => b.channelId !== id);
            if(state.activeChannelId === id) state.activeChannelId = null;
            saveState();
            renderChannels();
            renderBlocks();
        }
    },

    renameVertical: (oldName) => {
        const newName = prompt("Rename Group:", oldName);
        if(newName && newName !== oldName) {
            state.channels.forEach(c => {
                if(c.vertical === oldName) c.vertical = newName;
            });
            saveState();
            renderChannels();
        }
    },

    deleteVertical: (vert) => {
        if(confirm(`Dissolve "${vert}" group? Channels will be moved to General.`)) {
            state.channels = state.channels.map(c => c.vertical === vert ? { ...c, vertical: undefined } : c);
            saveState();
            renderChannels();
        }
    },

    /* Block Actions */
    openAddModal: (content = '', type = BlockType.TEXT) => {
        state.editingBlockId = null;
        document.getElementById('modal-title').textContent = "Add Block";
        
        const modal = document.getElementById('add-modal');
        const textarea = document.getElementById('add-content');
        const imgContainer = document.getElementById('image-preview-container');
        
        // Reset Inputs
        textarea.value = '';
        document.getElementById('edit-title').value = '';
        document.getElementById('edit-desc').value = '';
        document.getElementById('edit-tags').value = '';
        
        imgContainer.classList.add('hidden');
        textarea.classList.remove('hidden');
        document.getElementById('ai-preview').classList.add('hidden');
        
        const typeBtns = document.getElementById('type-selector').children;
        Array.from(typeBtns).forEach(b => {
             b.classList.remove('bg-white', 'text-black', 'border-white'); 
             b.classList.add('text-neutral-500', 'border-transparent');
             if(b.dataset.type === type) {
                 b.classList.remove('text-neutral-500', 'border-transparent');
                 b.classList.add('bg-white', 'text-black', 'border-white');
             }
        });

        if(type === BlockType.IMAGE) {
            textarea.value = content; 
            document.getElementById('image-preview').src = content;
            imgContainer.classList.remove('hidden');
            textarea.classList.add('hidden');
        } else {
            textarea.value = content;
        }

        modal.classList.remove('hidden');
        if(type !== BlockType.IMAGE) textarea.focus();
    },

    editBlock: (id) => {
        const b = state.blocks.find(x => x.id === id);
        if(!b) return;

        state.editingBlockId = id;
        document.getElementById('modal-title').textContent = "Edit Block";
        
        const modal = document.getElementById('add-modal');
        const textarea = document.getElementById('add-content');
        const imgContainer = document.getElementById('image-preview-container');

        // Populate Fields
        document.getElementById('edit-title').value = b.title || '';
        document.getElementById('edit-desc').value = b.description || '';
        document.getElementById('edit-tags').value = b.tags ? b.tags.join(', ') : '';
        
        // Handle Type & Content
        const typeBtns = document.getElementById('type-selector').children;
        Array.from(typeBtns).forEach(btn => {
             btn.classList.remove('bg-white', 'text-black', 'border-white'); 
             btn.classList.add('text-neutral-500', 'border-transparent');
             if(btn.dataset.type === b.type) {
                 btn.classList.remove('text-neutral-500', 'border-transparent');
                 btn.classList.add('bg-white', 'text-black', 'border-white');
             }
        });

        if(b.type === BlockType.IMAGE) {
            textarea.value = b.content;
            document.getElementById('image-preview').src = b.content;
            imgContainer.classList.remove('hidden');
            textarea.classList.add('hidden');
        } else {
            textarea.value = b.content;
            imgContainer.classList.add('hidden');
            textarea.classList.remove('hidden');
        }

        document.getElementById('ai-preview').classList.add('hidden');
        modal.classList.remove('hidden');
    },

    clearImage: () => {
        document.getElementById('add-content').value = '';
        document.getElementById('image-preview-container').classList.add('hidden');
        document.getElementById('add-content').classList.remove('hidden');
        document.querySelector(`button[data-type="${BlockType.TEXT}"]`).click();
        document.getElementById('add-content').focus();
    },

    closeModals: () => {
        document.getElementById('add-modal').classList.add('hidden');
        document.getElementById('api-modal').classList.add('hidden');
        state.editingBlockId = null;
    },

    analyzeCurrentInput: async () => {
        const typeBtn = document.querySelector('#type-selector .bg-white');
        const type = typeBtn ? typeBtn.dataset.type : 'text';
        const content = document.getElementById('add-content').value;

        if(!content || type === BlockType.IMAGE) return;

        const btn = document.getElementById('btn-analyze');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-3 h-3"></i> Thinking...`;
        lucide.createIcons();

        const result = await analyzeContent(content, type);
        
        // Auto-fill the manual fields
        document.getElementById('edit-title').value = result.title || '';
        document.getElementById('edit-desc').value = result.summary || '';
        document.getElementById('edit-tags').value = result.tags ? result.tags.join(', ') : '';

        // Show mini preview
        const preview = document.getElementById('ai-preview');
        preview.classList.remove('hidden');
        document.getElementById('ai-preview-title').textContent = result.title;
        document.getElementById('ai-preview-summary').textContent = result.summary;
        document.getElementById('ai-preview-tags').innerHTML = result.tags.map(t=>`<span class="bg-neutral-900 border border-neutral-700 px-1 text-[10px] uppercase">#${t}</span>`).join('');
        
        btn.innerHTML = originalHtml;
        lucide.createIcons();
    },

    submitNewBlock: () => {
        const typeBtn = document.querySelector('#type-selector .bg-white');
        const type = typeBtn ? typeBtn.dataset.type : 'text';
        const content = document.getElementById('add-content').value;

        if(!content) return;

        // Gather manual fields
        const title = document.getElementById('edit-title').value;
        const description = document.getElementById('edit-desc').value;
        const tagsStr = document.getElementById('edit-tags').value;
        const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);

        if (state.editingBlockId) {
            // UPDATE EXISTING
            const idx = state.blocks.findIndex(b => b.id === state.editingBlockId);
            if(idx !== -1) {
                state.blocks[idx] = {
                    ...state.blocks[idx],
                    type,
                    content,
                    title,
                    description,
                    tags
                };
            }
        } else {
            // CREATE NEW
            const newBlock = {
                id: `b_${Date.now()}`,
                createdAt: Date.now(),
                type,
                content,
                channelId: state.activeChannelId || (state.channels[0] ? state.channels[0].id : null),
                title,
                description,
                tags
            };
            state.blocks.unshift(newBlock);
        }
        
        saveState();
        renderBlocks();
        app.closeModals();
    },

    deleteBlock: (id) => {
        if(confirm('Remove this block?')) {
            state.blocks = state.blocks.filter(b => b.id !== id);
            saveState();
            renderBlocks();
        }
    },

    copyBlock: (id) => {
        const b = state.blocks.find(x => x.id === id);
        if(b) {
            navigator.clipboard.writeText(b.content);
            alert('Copied to clipboard');
        }
    },

    connectBlocks: async () => {
        const btn = document.getElementById('btn-connect');
        const txt = document.getElementById('connect-text');
        
        if(!state.apiKey) { app.openApiKeyModal(); return; }

        const originalText = txt.textContent;
        txt.textContent = 'Thinking...';
        
        const currentBlocks = state.blocks.filter(b => !state.activeChannelId || b.channelId === state.activeChannelId);
        
        if(currentBlocks.length < 2) {
            alert('Need at least 2 blocks to find connections.');
            txt.textContent = originalText;
            return;
        }

        const insight = await findConnections(currentBlocks);
        
        document.getElementById('insight-banner').classList.remove('hidden');
        document.getElementById('insight-text').textContent = insight;
        
        txt.textContent = originalText;
    },

    toggleMobileSidebar: () => {
        const sb = document.getElementById('sidebar');
        sb.classList.toggle('hidden');
        sb.classList.toggle('absolute');
        sb.classList.toggle('inset-0');
    },

    openApiKeyModal: () => {
        document.getElementById('api-key-input').value = state.apiKey;
        document.getElementById('api-modal').classList.remove('hidden');
    },

    saveApiKey: () => {
        const key = document.getElementById('api-key-input').value.trim();
        state.apiKey = key;
        localStorage.setItem('gemini_api_key', key);
        app.closeModals();
        renderChannels();
    },

    exportData: () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = "my_stash_backup.json";
        a.click();
    }
};

window.app = app;
app.init();

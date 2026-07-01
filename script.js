(function(){
  "use strict";

  // ---------- State ----------
  let tasks = [];
  let idCounter = 1;
  let currentFilter = "all";
  let searchTerm = "";

  const listEl = document.getElementById("taskList");
  const inputEl = document.getElementById("taskInput");
  const prioritySelect = document.getElementById("prioritySelect");
  const addBtn = document.getElementById("addBtn");
  const searchBox = document.getElementById("searchBox");
  const focusBody = document.getElementById("focusBody");
  const focusSub = document.getElementById("focusSub");
  const refreshFocusBtn = document.getElementById("refreshFocus");
  const progressFill = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");

  // ---------- Date ----------
  document.getElementById("dateDisplay").textContent =
    new Date().toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }) +
    "\n" + new Date().toLocaleTimeString(undefined, {hour:'2-digit', minute:'2-digit'});
  document.getElementById("dateDisplay").innerHTML =
    new Date().toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' }) +
    "<br>" + new Date().toLocaleTimeString(undefined, {hour:'2-digit', minute:'2-digit'});

  // ---------- AI helper ----------
  async function askAI(promptText, systemText){
    try{
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system: systemText,
          messages: [{ role: "user", content: promptText }]
        })
      });
      const data = await response.json();
      const text = (data.content || [])
        .map(block => block.type === "text" ? block.text : "")
        .join("")
        .trim();
      return text;
    }catch(err){
      console.error("AI request failed:", err);
      return null;
    }
  }

  function parseJSONLoose(text){
    if(!text) return null;
    const cleaned = text.replace(/```json/gi,"").replace(/```/g,"").trim();
    try{ return JSON.parse(cleaned); }catch(e){ return null; }
  }

  // ---------- Auto-tagging ----------
  const TAG_OPTIONS = ["work","health","personal","errand","learning","other"];

  async function autoTag(task){
    const prompt = `Classify this to-do item into exactly one tag from this list: ${TAG_OPTIONS.join(", ")}.
Task: "${task.text}"
Respond with ONLY the single tag word, nothing else.`;
    const result = await askAI(prompt, "You are a terse classifier. Reply with one lowercase word only, no punctuation, no explanation.");
    let tag = "other";
    if(result){
      const cleaned = result.toLowerCase().replace(/[^a-z]/g,"");
      if(TAG_OPTIONS.includes(cleaned)) tag = cleaned;
    }
    const t = tasks.find(x => x.id === task.id);
    if(t){ t.tag = tag; t.tagging = false; render(); }
  }

  // ---------- AI Focus suggestion ----------
  function heuristicFocus(){
    const active = tasks.filter(t => !t.done);
    if(active.length === 0) return null;
    const order = { high:0, medium:1, low:2 };
    active.sort((a,b) => (order[a.priority]??1) - (order[b.priority]??1) || a.createdAt - b.createdAt);
    return { task: active[0], reason: "Highest priority item still open." };
  }

  async function refreshFocusSuggestion(){
    const active = tasks.filter(t => !t.done);
    if(active.length === 0){
      focusBody.innerHTML = `<span class="focus-empty">Nothing open right now — add a task and I'll help you find where to start.</span>`;
      focusSub.textContent = "";
      return;
    }

    refreshFocusBtn.classList.add("spinning");
    focusBody.innerHTML = `<span class="focus-empty">Thinking…</span>`;
    focusSub.textContent = "";

    const listForPrompt = active.map(t => `- id:${t.id} | "${t.text}" | priority:${t.priority} | tag:${t.tag || "unsorted"}`).join("\n");
    const prompt = `Here is a person's open to-do list:
${listForPrompt}

Pick the single task they should do next, considering priority and how tasks tend to unblock or ease the rest of the day. Respond with ONLY compact JSON like:
{"id": <task id number>, "reason": "<one short sentence, under 14 words, second person, no quotes>"}`;

    const result = await askAI(prompt, "You are a focused, warm productivity coach. Always respond with only the requested JSON, no prose, no markdown fences.");
    const parsed = parseJSONLoose(result);

    refreshFocusBtn.classList.remove("spinning");

    let chosen = null, reason = "";
    if(parsed && parsed.id != null){
      chosen = active.find(t => t.id === Number(parsed.id));
      reason = parsed.reason || "";
    }
    if(!chosen){
      const fallback = heuristicFocus();
      if(!fallback) return;
      chosen = fallback.task;
      reason = fallback.reason;
    }

    focusBody.innerHTML = `Start with <span class="focus-task">"${escapeHTML(chosen.text)}"</span>`;
    focusSub.textContent = reason;
  }

  // ---------- Rendering ----------
  function escapeHTML(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function checkIcon(){
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }

  function render(){
    let visible = tasks.filter(t => {
      if(currentFilter === "active" && t.done) return false;
      if(currentFilter === "done" && !t.done) return false;
      if(searchTerm && !t.text.toLowerCase().includes(searchTerm)) return false;
      return true;
    });

    if(visible.length === 0){
      listEl.innerHTML = `<div class="empty-state">${tasks.length === 0 ? "Your list is empty. What's on your mind?" : "No tasks match here."}</div>`;
    }else{
      listEl.innerHTML = visible.map(t => `
        <div class="task ${t.done ? 'done':''}" data-id="${t.id}">
          <button class="checkbox" data-action="toggle" data-id="${t.id}">${checkIcon()}</button>
          <div class="task-main">
            <div class="task-text">${escapeHTML(t.text)}</div>
            <div class="task-meta">
              <span class="dot ${t.priority}"></span>
              <span>${t.priority}</span>
              <span class="tag ${t.tagging ? 'tagging':''}">${t.tagging ? 'tagging…' : (t.tag || 'other')}</span>
            </div>
          </div>
          <div class="task-actions">
            <button class="icon-btn" data-action="delete" data-id="${t.id}" title="Delete">✕</button>
          </div>
        </div>
      `).join("");
    }

    const doneCount = tasks.filter(t => t.done).length;
    const total = tasks.length;
    progressFill.style.width = total ? `${Math.round((doneCount/total)*100)}%` : "0%";
    progressLabel.textContent = `${doneCount} of ${total} done`;
  }

  // ---------- Actions ----------
  function addTask(){
    const text = inputEl.value.trim();
    if(!text) return;
    const task = {
      id: idCounter++,
      text,
      done:false,
      priority: prioritySelect.value,
      tag:null,
      tagging:true,
      createdAt: Date.now()
    };
    tasks.unshift(task);
    inputEl.value = "";
    render();
    autoTag(task);
    refreshFocusSuggestion();
  }

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if(!btn) return;
    const id = Number(btn.dataset.id);
    const task = tasks.find(t => t.id === id);
    if(!task) return;

    if(btn.dataset.action === "toggle"){
      task.done = !task.done;
      render();
      refreshFocusSuggestion();
    }else if(btn.dataset.action === "delete"){
      tasks = tasks.filter(t => t.id !== id);
      render();
      refreshFocusSuggestion();
    }
  });

  addBtn.addEventListener("click", addTask);
  inputEl.addEventListener("keydown", (e) => { if(e.key === "Enter") addTask(); });

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  searchBox.addEventListener("input", () => {
    searchTerm = searchBox.value.trim().toLowerCase();
    render();
  });

  refreshFocusBtn.addEventListener("click", refreshFocusSuggestion);

  // ---------- Seed with a couple of example tasks ----------
  tasks = [
    { id: idCounter++, text:"Reply to Sam about the proposal", done:false, priority:"high", tag:"work", tagging:false, createdAt: Date.now()-3600000 },
    { id: idCounter++, text:"Book dentist appointment", done:false, priority:"low", tag:"health", tagging:false, createdAt: Date.now()-1800000 },
    { id: idCounter++, text:"Water the plants", done:true, priority:"low", tag:"personal", tagging:false, createdAt: Date.now()-7200000 },
  ];

  render();
  refreshFocusSuggestion();
})();
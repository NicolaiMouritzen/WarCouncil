const WarCouncil = (() => {
  const apiGet = async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    return res.json();
  };

  const apiPost = async (url, data) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
  };

  const parseTarget = (text, council) => {
    const match = text.match(/@([A-Za-z\s]+)/);
    if (!match) {
      return { text, targetName: null };
    }
    const name = match[1].trim();
    const councilor = council.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!councilor) {
      return { text, targetName: null };
    }
    const cleaned = text.replace(match[0], "").trim();
    return { text: cleaned, targetName: councilor.name };
  };

  const supportDotClass = (support) => {
    if (support === null || typeof support !== "number") {
      return "none";
    }
    if (support <= 3) return "low";
    if (support <= 7) return "mid";
    return "high";
  };

  const createModal = () => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const open = (content) => {
      modal.innerHTML = "";
      modal.appendChild(content);
      backdrop.style.display = "flex";
    };

    const close = () => {
      backdrop.style.display = "none";
    };

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close();
      }
    });

    return { open, close };
  };

  const addHoverExpand = (element) => {
    let timer = null;
    element.addEventListener("mouseenter", () => {
      timer = setTimeout(() => {
        element.classList.add("expanded");
      }, 1000);
    });
    element.addEventListener("mouseleave", () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      element.classList.remove("expanded");
    });
  };

  return {
    apiGet,
    apiPost,
    parseTarget,
    supportDotClass,
    createModal,
    addHoverExpand
  };
})();

window.WarCouncil = WarCouncil;

(() => {
  "use strict";

  if (globalThis.__applyKitLoaded) return;
  globalThis.__applyKitLoaded = true;

  const matcher = globalThis.ApplyKitMatcher;
  const PANEL_ID = "applykit-review-panel";
  let currentProposals = [];
  let currentProfile = {};

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!["APPLYKIT_SCAN", "APPLYKIT_ANALYZE", "APPLYKIT_AUTOFILL"].includes(message?.type)) {
      return false;
    }
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  async function handleMessage(message) {
    currentProfile = message.profile || {};
    currentProposals = analyzePage(currentProfile);
    if (message.type === "APPLYKIT_SCAN") {
      return {
        ok: true,
        count: currentProposals.length,
        categories: summarizeCategories(currentProposals)
      };
    }
    if (message.type === "APPLYKIT_ANALYZE") {
      renderReviewPanel(currentProposals);
      return { ok: true, count: currentProposals.length };
    }

    const results = [];
    for (const proposal of currentProposals) {
      results.push(await fillProposal(proposal, message.profile || {}));
    }
    renderResultsPanel(results);
    return {
      ok: true,
      count: currentProposals.length,
      filled: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length
    };
  }

  function analyzePage(profile) {
    removeExistingPanel();
    return Array.from(document.querySelectorAll("input, select, textarea, [role='combobox']"))
      .filter((element) => {
        if (element.matches("input, select, textarea")) return true;
        return !element.querySelector("input, select, textarea, [role='combobox']");
      })
      .filter(isUsable)
      .map((element, index) => {
        const field = describeField(element);
        const proposal = matcher.propose(field, profile);
        return proposal ? { ...proposal, id: `field-${index}`, element, field } : null;
      })
      .filter(Boolean);
  }

  function isUsable(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      !element.disabled &&
      (!element.readOnly || element.getAttribute("role") === "combobox") &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function describeField(element) {
    const options = element instanceof HTMLSelectElement
      ? Array.from(element.options).map((option) => ({
          value: option.value,
          label: option.textContent.trim()
        }))
      : [];
    return {
      label: getFieldLabel(element),
      type: String(element.type || "text").toLowerCase(),
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      placeholder: element.getAttribute("placeholder") || "",
      disabled: element.disabled,
      readOnly: element.readOnly,
      required: element.required,
      options
    };
  }

  function getFieldLabel(element) {
    const parts = [];
    if (element.labels) {
      for (const label of element.labels) {
        parts.push(label.innerText || label.textContent || "");
      }
    }
    parts.push(
      element.getAttribute("aria-label") || "",
      getAriaLabelledBy(element),
      element.getAttribute("placeholder") || "",
      element.getAttribute("name") || "",
      element.getAttribute("id") || ""
    );
    const parentText = element.closest(
      "label, [role='group'], .form-field, .field, .field-wrapper, .form-group"
    )?.textContent || "";
    if (parentText.length < 300) parts.push(parentText);
    return [...new Set(parts.map((part) => String(part).trim()).filter(Boolean))].join(" · ");
  }

  function getAriaLabelledBy(element) {
    const ids = (element.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ");
  }

  function summarizeCategories(proposals) {
    const groups = new Set();
    const personal = new Set([
      "firstName", "lastName", "preferredName", "email", "phone",
      "addressLine1", "addressLine2", "city", "region", "postalCode", "country"
    ]);
    const education = new Set([
      "school", "degree", "fieldOfStudy", "educationStartDate", "graduationDate", "gpa"
    ]);
    const links = new Set(["linkedin", "github", "portfolio"]);
    for (const proposal of proposals) {
      if (personal.has(proposal.key)) groups.add("Personal info");
      else if (education.has(proposal.key)) groups.add("Education");
      else if (links.has(proposal.key)) groups.add("Links");
    }
    return [...groups];
  }

  async function fillProposal(proposal, profile) {
    try {
      const isCustomCombobox =
        proposal.field.role === "combobox" && !(proposal.element instanceof HTMLSelectElement);
      const ok = isCustomCombobox
        ? await fillCustomCombobox(proposal, profile)
        : fillNativeElement(proposal.element, proposal.value);
      return { ...proposal, ok, reason: ok ? "Filled" : "Could not choose a matching option" };
    } catch (error) {
      return { ...proposal, ok: false, reason: error.message };
    }
  }

  async function fillCustomCombobox(proposal, profile) {
    const element = proposal.element;
    const originalValue = "value" in element ? element.value : "";
    const desired = [proposal.displayValue, proposal.value];
    if (proposal.key === "degree") {
      desired.push(...(profile?.education?.degreeAliases || []));
    }

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.focus();
    element.click();

    // Custom widgets often ignore raw value changes, so open and select their visible option.
    let option = null;
    if (element instanceof HTMLInputElement) {
      const uniqueDesired = [...new Set(desired.filter(Boolean))];
      for (const candidate of uniqueDesired) {
        setNativeValue(element, candidate);
        dispatchValueEvents(element, candidate, false);
        option = await waitForMatchingOption(element, [candidate]);
        if (option) break;
      }
    } else {
      option = await waitForMatchingOption(element, desired);
    }

    if (!option) {
      if (element instanceof HTMLInputElement) {
        setNativeValue(element, originalValue);
        dispatchValueEvents(element, originalValue, true);
      }
      return false;
    }

    option.scrollIntoView({ block: "nearest" });
    option.click();
    await delay(60);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    markFilled(element);
    return true;
  }

  async function waitForMatchingOption(combobox, desiredValues) {
    const desired = desiredValues.map(matcher.normalize).filter(Boolean);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const options = getCandidateOptions(combobox).filter(isUsable);
      const exact = options.find((option) => desired.includes(matcher.normalize(option.textContent)));
      if (exact) return exact;
      const contained = options.find((option) => {
        const text = matcher.normalize(option.textContent);
        return desired.some((value) => text.includes(value) || value.includes(text));
      });
      if (contained) return contained;
      await delay(100);
    }
    return null;
  }

  function getCandidateOptions(combobox) {
    const controlledId = combobox.getAttribute("aria-controls") || combobox.getAttribute("aria-owns");
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const selector = "[role='option'], [role='listbox'] li, [role='listbox'] button, [data-value]";
    return Array.from((controlled || document).querySelectorAll(selector)).filter((option) => {
      return option !== combobox && !option.contains(combobox) && option.textContent?.trim();
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function renderReviewPanel(proposals) {
    const host = document.createElement("div");
    host.id = PANEL_ID;
    host.style.cssText =
      "all: initial; position: fixed; z-index: 2147483647; top: 18px; right: 18px;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light; }
      * { box-sizing: border-box; }
      .panel { width: min(390px, calc(100vw - 28px)); max-height: calc(100vh - 28px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e2e6df; border-radius: 18px; background: #f7f5f0; color: #293b34; font: 14px/1.4 ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 18px 55px rgba(41, 59, 52, .18); }
      header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e2e6df; }
      h2 { margin: 0; font-size: 17px; }
      .close { min-height: 32px; border: 0; background: transparent; color: #78857b; font-size: 22px; }
      .summary { margin: 0; padding: 12px 18px; border-bottom: 1px solid #e2e6df; color: #78857b; font-size: 12px; }
      .list { overflow: auto; }
      .item { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 7px; padding: 11px 18px; border-bottom: 1px solid #e5e8e1; cursor: pointer; }
      .item:last-child { border-bottom: 0; }
      .item > input { margin-top: 3px; accent-color: #567c65; }
      .label { display: block; overflow: hidden; color: #293b34; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .value { display: block; width: 100%; margin-top: 5px; border: 1px solid #d8ded7; border-radius: 8px; padding: 7px 8px; background: #fff; color: #4c5d54; font: inherit; font-size: 12px; outline: none; }
      .value:focus { border-color: #567c65; box-shadow: 0 0 0 3px rgba(86,124,101,.12); }
      .confidence { display: block; margin-top: 4px; color: #78857b; font-size: 10px; }
      .empty { padding: 28px 18px; color: #78857b; text-align: center; }
      footer { display: flex; gap: 8px; padding: 14px 18px; border-top: 1px solid #e2e6df; }
      button { min-height: 38px; border: 1px solid #ccd6ce; border-radius: 10px; padding: 0 14px; background: #fff; color: #40544a; font: inherit; font-weight: 650; cursor: pointer; }
      .primary { flex: 1; border-color: #567c65; background: #567c65; color: #fff; }
      button:disabled { cursor: default; opacity: .5; }
    `;
    shadow.append(style);

    const panel = document.createElement("section");
    panel.className = "panel";

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = "koalified review";
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    header.append(title, close);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = `${proposals.length} field${proposals.length === 1 ? "" : "s"} matched. Review every value before filling.`;
    const list = document.createElement("div");
    list.className = "list";
    const footer = document.createElement("footer");
    const selectAll = document.createElement("button");
    selectAll.className = "select-all";
    selectAll.type = "button";
    selectAll.textContent = "Clear all";
    const fill = document.createElement("button");
    fill.className = "primary";
    fill.type = "button";
    fill.disabled = proposals.length === 0;
    fill.textContent = "Fill selected";
    footer.append(selectAll, fill);
    panel.append(header, summary, list, footer);
    shadow.append(panel);
    document.documentElement.append(host);

    if (!proposals.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No safe profile matches were found on this page. Nothing was changed.";
      list.append(empty);
    } else {
      for (const proposal of proposals) {
        const row = document.createElement("div");
        row.className = "item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.proposalId = proposal.id;
        checkbox.setAttribute("aria-label", `Include ${proposal.field.label || proposal.key}`);
        const copy = document.createElement("span");
        const fieldName = document.createElement("span");
        fieldName.className = "label";
        fieldName.textContent = proposal.field.label || proposal.key;
        const value = document.createElement("input");
        value.type = "text";
        value.className = "value";
        value.value = proposal.displayValue;
        value.setAttribute("aria-label", `Proposed value for ${proposal.field.label || proposal.key}`);
        value.addEventListener("change", () => updateProposalValue(proposal, value));
        const confidence = document.createElement("span");
        confidence.className = "confidence";
        confidence.textContent = `${Math.round(proposal.confidence * 100)}% match · ${proposal.key}`;
        copy.append(fieldName, value, confidence);
        row.append(checkbox, copy);
        row.addEventListener("mouseenter", () => highlight(proposal.element, true));
        row.addEventListener("mouseleave", () => highlight(proposal.element, false));
        list.append(row);
      }
    }

    close.addEventListener("click", removeExistingPanel);
    selectAll.addEventListener("click", () => {
      const boxes = [...list.querySelectorAll("input[type='checkbox']")];
      const shouldSelect = boxes.some((box) => !box.checked);
      boxes.forEach((box) => {
        box.checked = shouldSelect;
      });
      selectAll.textContent = shouldSelect ? "Clear all" : "Select all";
    });
    fill.addEventListener("click", async () => {
      const selectedIds = new Set(
        [...list.querySelectorAll("input[type='checkbox']:checked")].map(
          (box) => box.dataset.proposalId
        )
      );
      fill.disabled = true;
      fill.textContent = "Filling…";
      let filled = 0;
      for (const proposal of currentProposals) {
        if (!selectedIds.has(proposal.id)) continue;
        const result = await fillProposal(proposal, currentProfile);
        if (result.ok) filled += 1;
      }
      summary.textContent = `${filled} field${filled === 1 ? "" : "s"} filled. Please review the application before continuing.`;
      fill.disabled = true;
      fill.textContent = "Filled";
    });
  }

  function updateProposalValue(proposal, input) {
    const edited = input.value.trim();
    if (!edited) {
      input.value = proposal.displayValue;
      return;
    }
    if (proposal.field.tagName === "select") {
      const aliases = proposal.key === "degree"
        ? currentProfile?.education?.degreeAliases || []
        : [];
      const option = matcher.chooseOption(proposal.field.options, edited, aliases);
      if (!option) {
        input.value = proposal.displayValue;
        return;
      }
      proposal.value = option.value;
      proposal.displayValue = option.label || option.text || option.value;
      input.value = proposal.displayValue;
      return;
    }
    proposal.value = edited;
    proposal.displayValue = edited;
  }

  function fillNativeElement(element, value) {
    if (!element?.isConnected) return false;
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    if (!Object.getOwnPropertyDescriptor(prototype, "value")?.set) return false;
    // The prototype setter lets controlled React-style inputs observe the update.
    setNativeValue(element, value);
    dispatchValueEvents(element, value, true);
    const changed = element.value === String(value);
    if (changed) markFilled(element);
    return changed;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  }

  function dispatchValueEvents(element, value, includeChange) {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: String(value)
    }));
    if (includeChange) element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function markFilled(element) {
    element.style.outline = "2px solid #56866a";
    element.style.outlineOffset = "2px";
  }

  function renderResultsPanel(results) {
    removeExistingPanel();
    const filled = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    const host = document.createElement("div");
    host.id = PANEL_ID;
    host.style.cssText =
      "all: initial; position: fixed; z-index: 2147483647; top: 18px; right: 18px;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      .result { width: min(360px, calc(100vw - 28px)); overflow: hidden; border: 1px solid #e2e6df; border-radius: 18px; background: #f7f5f0; color: #293b34; font: 13px/1.45 ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 16px 50px rgba(41,59,52,.18); }
      header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
      h2 { margin: 0; font-size: 16px; }
      button { border: 0; background: transparent; color: #78857b; font-size: 22px; cursor: pointer; }
      .count { padding: 16px 18px; border-top: 1px solid #e2e6df; border-bottom: 1px solid #e2e6df; background: #fff; }
      strong { color: #567c65; font-size: 25px; }
      p { margin: 4px 0 0; color: #78857b; }
      ul { max-height: 220px; overflow: auto; margin: 0; padding: 8px 18px 12px 38px; }
      li { padding: 4px 0; }
      .warning { color: #b58a43; }
      footer { padding: 12px 18px; color: #78857b; font-size: 11px; }
    `;
    const panel = document.createElement("section");
    panel.className = "result";
    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = "koalified finished";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    header.append(title, close);
    const count = document.createElement("div");
    count.className = "count";
    const number = document.createElement("strong");
    number.textContent = String(filled.length);
    const description = document.createElement("p");
    description.textContent = `field${filled.length === 1 ? "" : "s"} filled. Review every answer before continuing.`;
    count.append(number, description);
    panel.append(header, count);
    if (failed.length) {
      const list = document.createElement("ul");
      list.className = "warning";
      for (const result of failed) {
        const item = document.createElement("li");
        item.textContent = `${result.field.label || result.key}: ${result.reason}`;
        list.append(item);
      }
      panel.append(list);
    }
    const footer = document.createElement("footer");
    footer.textContent = "koalified did not click Next, Apply, or Submit.";
    panel.append(footer);
    shadow.append(style, panel);
    document.documentElement.append(host);
    close.addEventListener("click", removeExistingPanel);
  }

  function highlight(element, enabled) {
    if (!element?.isConnected) return;
    if (enabled) {
      element.dataset.applyKitPreviousOutline = element.style.outline;
      element.style.outline = "3px solid #b58a43";
      element.style.outlineOffset = "2px";
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      element.style.outline = element.dataset.applyKitPreviousOutline || "";
      delete element.dataset.applyKitPreviousOutline;
    }
  }

  function removeExistingPanel() {
    document.getElementById(PANEL_ID)?.remove();
  }
})();

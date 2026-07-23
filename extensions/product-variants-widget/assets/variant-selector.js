(function () {
  function initRoot(root) {
    var dataEl = root.querySelector("[data-pv-variants]");
    if (!dataEl) return;

    var variants;
    try {
      variants = JSON.parse(dataEl.textContent);
    } catch (e) {
      return;
    }

    var idInput = root.querySelector("[data-pv-variant-id]");
    var priceEl = root.querySelector("[data-pv-price]");
    var availabilityEl = root.querySelector("[data-pv-availability]");
    var submitBtn = root.querySelector("[data-pv-submit]");
    var submitText = root.querySelector("[data-pv-submit-text]");
    var inputs = Array.prototype.slice.call(
      root.querySelectorAll("[data-pv-option-input]")
    );

    var buttonLabel =
      (submitBtn && submitBtn.getAttribute("data-pv-button-label")) ||
      "Add to cart";

    // Native variant image support: swap the theme's product image when the
    // selected variant has its own image, falling back to the product default.
    var defaultImage = root.getAttribute("data-pv-default-image") || "";
    var gallerySelector = root.getAttribute("data-pv-gallery-selector") || "";

    function swapGalleryImage(variant) {
      if (!gallerySelector) return;
      var url = (variant && variant.image) || defaultImage;
      if (!url) return;
      var img = document.querySelector(gallerySelector);
      if (!img) return;
      // srcset would otherwise win over the src we set.
      if (img.getAttribute("srcset")) img.setAttribute("srcset", url);
      img.src = url;
    }

    // Set when the merchant hides our Add to cart, meaning the theme's button
    // is doing the work -- so it has to be told which variant was picked here,
    // or it would submit whatever its own picker last had.
    var syncsThemeForm = root.hasAttribute("data-pv-sync-theme-form");

    function syncThemeForm(variantId) {
      if (!syncsThemeForm) return;

      var forms = document.querySelectorAll('form[action*="/cart/add"]');
      Array.prototype.forEach.call(forms, function (form) {
        if (root.contains(form)) return; // never our own form
        var input = form.querySelector('input[name="id"]');
        if (input) input.value = variantId;
      });

      // Keeps the URL shareable and themes that read ?variant= in step.
      // Guarded: this file has no build step, and a throw here would take the
      // option handlers down with it.
      try {
        if (window.history && window.history.replaceState && window.URL) {
          var url = new window.URL(window.location.href);
          url.searchParams.set("variant", variantId);
          window.history.replaceState({}, "", url.toString());
        }
      } catch (e) {
        /* older browsers: the form input above is what actually matters */
      }
    }

    function getSelectedOptions() {
      var groups = {};
      inputs.forEach(function (input) {
        var pos = input.getAttribute("data-pv-option-position");
        if (input.tagName === "SELECT") {
          groups[pos] = input.value;
        } else if (input.checked) {
          groups[pos] = input.value;
        }
      });
      return Object.keys(groups)
        .sort(function (a, b) {
          return Number(a) - Number(b);
        })
        .map(function (pos) {
          return groups[pos];
        });
    }

    function findVariant(selected) {
      return variants.find(function (variant) {
        if (!variant.options || variant.options.length !== selected.length) {
          return false;
        }
        return variant.options.every(function (option, index) {
          return option === selected[index];
        });
      });
    }

    function update() {
      var selected = getSelectedOptions();
      var variant = findVariant(selected);

      if (!variant) {
        if (idInput) idInput.value = "";
        if (submitBtn) submitBtn.disabled = true;
        if (submitText) submitText.textContent = "Unavailable";
        if (availabilityEl) availabilityEl.textContent = "Unavailable";
        return;
      }

      if (idInput) idInput.value = variant.id;
      syncThemeForm(variant.id);
      swapGalleryImage(variant);
      if (priceEl) priceEl.innerHTML = variant.price;
      if (availabilityEl) {
        availabilityEl.textContent = variant.available ? "In stock" : "Sold out";
      }
      if (submitBtn) submitBtn.disabled = !variant.available;
      if (submitText) {
        submitText.textContent = variant.available ? buttonLabel : "Sold out";
      }
    }

    inputs.forEach(function (input) {
      input.addEventListener("change", update);
    });

    update();
  }

  function init() {
    var roots = document.querySelectorAll("[data-pv-root]");
    Array.prototype.forEach.call(roots, initRoot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

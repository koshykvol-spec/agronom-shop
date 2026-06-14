// ==========================================
// КОШИК — єдиний файл для всіх сторінок
// Щоб змінити кошик — редагуйте лише цей файл
// ==========================================

(function () {
    const cartHTML = `
    <div id="cart-modal" class="modal" role="dialog" aria-modal="true" aria-label="Кошик" onclick="if(event.target==this)closeCart()">
        <div class="cart-ui">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2 style="font-family:'Playfair Display'; margin:0;">Ваше замовлення</h2>
                <button onclick="clearCart()" style="background:none; border:1px solid #ff4d4d; color:#ff4d4d; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:bold; display:flex; align-items:center; gap:5px;">
                    🗑️ Очистити
                </button>
            </div>

            <div id="cart-list"></div>

            <div style="font-size:1.4rem; font-weight:800; margin:20px 0; text-align:right; color:var(--green);">
                Разом: <span id="cart-total">0</span> грн
            </div>

            <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px; padding:0 10px;">
                <button class="btn" onclick="sendToTelegram()" style="background:#0088cc; color:white; padding:14px; font-weight:bold; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:1rem;">
                    <svg width="20" height="20" viewBox="0 0 240 240" fill="#fff" aria-hidden="true" style="flex-shrink:0"><path d="M120 0C53.7 0 0 53.7 0 120s53.7 120 120 120 120-53.7 120-120S186.3 0 120 0zm58.3 80.2l-19.5 91.9c-1.4 6.5-5.3 8.1-10.8 5l-29.8-22-14.4 13.8c-1.6 1.6-2.9 2.9-6 2.9l2.1-30.3 55.2-49.9c2.4-2.1-.5-3.3-3.7-1.2l-68.2 42.9-29.4-9.2c-6.4-2-6.5-6.4 1.3-9.5l114.9-44.3c5.3-1.9 10 1.3 8.3 9.2z"/></svg> Оформити замовлення
                </button>
                <button class="btn" onclick="openQuickOrder()" style="background:#fff; color:var(--green); border:2px solid var(--green); padding:12px; font-weight:bold; border-radius:8px; font-size:.95rem;">
                    📞 Замовити дзвінком (швидко)
                </button>
            </div>

            <button class="btn" style="background:#eee; color:#333; margin-top:10px;" onclick="closeCart()">
                Продовжити покупки
            </button>
        </div>
    </div>`;

    // Вставляємо кошик у контейнер
    const container = document.getElementById('cart-modal-container');
    if (container) container.innerHTML = cartHTML;
})();

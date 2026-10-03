const STORAGE_KEY = "wishwell.accounts.v1";
const SESSION_KEY = "wishwell.current-account.v1";
const DEFAULT_CATEGORIES = ["For the home", "Little luxuries"];
const cloudConfig = window.WISHES_SUPABASE || {};
const cloudEnabled = Boolean(
	window.supabase?.createClient &&
	typeof cloudConfig.url === "string" && cloudConfig.url.startsWith("https://") &&
	typeof cloudConfig.publishableKey === "string" && cloudConfig.publishableKey.trim()
);
const cloud = cloudEnabled ? window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey) : null;
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85";
const CAMERA_IMAGE = "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85";
const LEGACY_CAMERA_FALLBACK = "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85";
const PREVIEW_ITEMS = [
	{ id: "demo-camera", title: "The everyday camera", category: "Little luxuries", price: 5500000, image: CAMERA_IMAGE, note: "For ordinary days worth remembering.", received: false, createdAt: 4 },
	{ id: "demo-bag", title: "The forever bag", category: "Little luxuries", price: 1850000, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85", note: "An everyday piece with a little polish.", received: false, createdAt: 3 },
	{ id: "demo-headphones", title: "Cloud-soft headphones", category: "Little luxuries", price: 2250000, image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85", note: "A tiny bit of quiet, wherever I go.", received: false, createdAt: 2 },
	{ id: "demo-sofa", title: "The Sunday sofa", category: "For the home", price: 18000000, image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85", note: "For slow mornings and long movie nights.", received: false, createdAt: 1 }
];

const ICONS = {
	check: "m5 12 4 4 10-10",
	trash: "M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"
};

const state = {
	account: null,
	cloudChannel: null,
	filter: "all",
	category: "",
	search: "",
	sort: "newest",
	toastTimer: 0
};

const element = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
const authEmailFor = (username) => `${normalizeUsername(username)}@accounts.ourwishes.invalid`;

function readAccounts() {
	try {
		const accounts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		return Array.isArray(accounts) ? accounts.map(normalizeAccount) : [];
	} catch {
		return [];
	}
}

function normalizeAccount(account) {
	return {
		...account,
		items: Array.isArray(account.items) ? account.items.map(({ saved, ...item }) => ({
			...item,
			image: item.image === LEGACY_CAMERA_FALLBACK && !isCameraWish(item.title) ? automaticImage(item.title, item.category) : item.image,
			received: Boolean(item.received)
		})) : [],
		categories: Array.isArray(account.categories) ? account.categories : [...DEFAULT_CATEGORIES]
	};
}

function writeAccounts(accounts) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

function persistAccount() {
	const accounts = readAccounts();
	const index = accounts.findIndex((account) => account.id === state.account.id);
	if (index < 0) return;
	accounts[index] = normalizeAccount(state.account);
	writeAccounts(accounts);
}

function mapCloudWish(row) {
	const title = row.title;
	const category = row.category || "Unsorted";
	return {
		id: row.id,
		title,
		price: row.price === null ? null : Number(row.price) || 0,
		category,
		image: row.image_url === LEGACY_CAMERA_FALLBACK && !isCameraWish(title) ? automaticImage(title, category) : row.image_url || "",
		note: row.note || "",
		received: Boolean(row.received),
		createdAt: new Date(row.created_at).getTime()
	};
}

async function migrateLegacyWishlist(user) {
	const markerKey = `wishwell.migrated.${user.id}`;
	if (localStorage.getItem(markerKey)) return;
	const username = normalizeUsername(user.user_metadata?.username || user.email?.split("@")[0]);
	const legacy = readAccounts().find((account) =>
		account.username === username || account.email === user.email?.toLowerCase() || normalizeUsername(account.name) === username
	);
	if (!legacy) {
		localStorage.setItem(markerKey, "done");
		return;
	}
	const { count, error: countError } = await cloud.from("wishlist_items").select("id", { count: "exact", head: true });
	if (countError) throw countError;
	if ((count || 0) > 0) {
		localStorage.setItem(markerKey, "done");
		return;
	}
	const categories = [...new Set([...DEFAULT_CATEGORIES, ...legacy.categories])].map((name) => ({ user_id: user.id, name }));
	const { error: categoryError } = await cloud.from("wishlist_categories").upsert(categories, { onConflict: "user_id,name", ignoreDuplicates: true });
	if (categoryError) throw categoryError;
	if (legacy.items.length) {
		const rows = legacy.items.map((item) => ({
			user_id: user.id,
			title: item.title,
			price: item.price == null ? null : Number(item.price) || 0,
			category: item.category || "Unsorted",
			image_url: item.image || "",
			note: item.note || "",
			received: Boolean(item.received),
			created_at: new Date(Number(item.createdAt) || Date.now()).toISOString()
		}));
		const { error } = await cloud.from("wishlist_items").insert(rows);
		if (error) throw error;
	}
	localStorage.setItem(markerKey, "done");
}

async function activateCloudAccount(user) {
	const userId = user.id;
	await migrateLegacyWishlist(user);
	const { error: seedError } = await cloud.from("wishlist_categories").upsert(
		DEFAULT_CATEGORIES.map((name) => ({ user_id: userId, name })),
		{ onConflict: "user_id,name", ignoreDuplicates: true }
	);
	if (seedError) throw seedError;

	const [wishResult, categoryResult] = await Promise.all([
		cloud.from("wishlist_items").select("*").order("created_at", { ascending: false }),
		cloud.from("wishlist_categories").select("name").order("created_at", { ascending: true })
	]);
	if (wishResult.error) throw wishResult.error;
	if (categoryResult.error) throw categoryResult.error;
	const items = (wishResult.data || []).map(mapCloudWish);
	const categories = [...new Set([...DEFAULT_CATEGORIES, ...(categoryResult.data || []).map((row) => row.name), ...items.map((item) => item.category)])];
	state.account = {
		id: userId,
		name: user.user_metadata?.name || username || "Wishmaker",
		username,
		email: user.email || "",
		items,
		categories
	};
	render();
	watchCloudAccount(userId);
}

function watchCloudAccount(userId) {
	if (state.cloudChannel) cloud.removeChannel(state.cloudChannel);
	state.cloudChannel = cloud.channel(`wishlist:${userId}`)
		.on("postgres_changes", { event: "*", schema: "public", table: "wishlist_items", filter: `user_id=eq.${userId}` }, () => refreshCloudAccount(userId))
		.on("postgres_changes", { event: "*", schema: "public", table: "wishlist_categories", filter: `user_id=eq.${userId}` }, () => refreshCloudAccount(userId))
		.subscribe();
}

async function refreshCloudAccount(userId) {
	if (!state.account || state.account.id !== userId) return;
	try {
		const [wishResult, categoryResult] = await Promise.all([
			cloud.from("wishlist_items").select("*").order("created_at", { ascending: false }),
			cloud.from("wishlist_categories").select("name").order("created_at", { ascending: true })
		]);
		if (wishResult.error) throw wishResult.error;
		if (categoryResult.error) throw categoryResult.error;
		const items = (wishResult.data || []).map(mapCloudWish);
		state.account.items = items;
		state.account.categories = [...new Set([...DEFAULT_CATEGORIES, ...(categoryResult.data || []).map((row) => row.name), ...items.map((item) => item.category)])];
		render();
	} catch (error) {
		console.error("Could not sync wishlist changes", error);
	}
}

function currentItems() {
	return state.account ? state.account.items : PREVIEW_ITEMS;
}

function automaticImage(title, category) {
	const keywords = `${title || ""} ${category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
	if (isCameraWish(keywords)) return CAMERA_IMAGE;
	if (/\b(sepatu|shoe|shoes|sneaker|sneakers|sandal|sandals|boots|boot|footwear|heels)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(tas|bag|handbag|tote|purse|backpack|ransel)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(headphone|headphones|earphone|earphones|headset|audio)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(buku|book|novel|journal|jurnal|notebook|komik|comic)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(tanaman|plant|flower|bunga|pot|succulent)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(baju|shirt|t-shirt|kaos|clothes|clothing|jacket|jaket|dress|hoodie)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(jam|watch|smartwatch)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(laptop|computer|komputer)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(phone|ponsel|hp|smartphone|tablet|ipad)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(perhiasan|jewelry|jewellery|kalung|necklace|cincin|ring|gelang|bracelet|anting|earrings)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(mobil|car|vehicle|kendaraan)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(sepeda|bicycle|bike)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(anjing|dog|puppy|kucing|cat|pet|hewan)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(makeup|make-up|cosmetic|kosmetik|lipstick|lipstik|skincare|parfum|perfume)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=85";
	}
	if (/\b(rumah|home|sofa|furniture|furnitur|lamp|lampu|vase|vas|meja|kursi|rak|bed|kasur)\b/.test(keywords)) {
		return "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85";
	}
	return FALLBACK_IMAGE;
}

function isCameraWish(value) {
	const keywords = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
	return /\b(camera|kamera|photography|foto)\b/.test(keywords);
}

function resolveWishImage(value, title, category) {
	if (String(value || "").trim()) {
		try {
			const url = new URL(value);
			if (url.protocol === "https:") return url.href;
		} catch {
			return automaticImage(title, category);
		}
	}
	return automaticImage(title, category);
}

function makeIcon(name) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.8");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", ICONS[name] || "");
	svg.append(path);
	return svg;
}

function iconButton(className, label, iconName, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.setAttribute("aria-label", label);
	button.title = label;
	button.append(makeIcon(iconName));
	button.addEventListener("click", onClick);
	return button;
}

function renderCard(item, isPreview) {
	const card = document.createElement("article");
	card.className = `wish-card${item.received ? " is-received" : ""}`;

	const imageWrap = document.createElement("div");
	imageWrap.className = "card-image-wrap";
	const image = document.createElement("img");
	image.className = "card-image";
	const fallbackImage = automaticImage(item.title, item.category);
	image.src = resolveWishImage(item.image, item.title, item.category);
	image.alt = item.title;
	image.loading = "lazy";
	image.addEventListener("error", () => { image.src = fallbackImage; }, { once: true });
	imageWrap.append(image);

	const category = document.createElement("span");
	category.className = "image-category";
	category.textContent = item.category || "A little something";
	imageWrap.append(category);
	if (item.received) {
		const received = document.createElement("span");
		received.className = "received-label";
		received.textContent = "It's yours";
		imageWrap.append(received);
	}

	const content = document.createElement("div");
	content.className = "card-content";
	const titleRow = document.createElement("div");
	titleRow.className = "card-title-row";
	const title = document.createElement("h3");
	title.textContent = item.title;
	const price = document.createElement("span");
	price.className = "card-price";
	price.textContent = item.price == null || item.price === "" ? "—" : money.format(Number(item.price) || 0);
	titleRow.append(title, price);

	const note = document.createElement("p");
	note.className = "card-note";
	note.textContent = item.note || "A little something to look forward to.";
	const divider = document.createElement("div");
	divider.className = "card-divider";
	const actions = document.createElement("div");
	actions.className = "card-actions";
	if (isPreview) {
		const previewLabel = document.createElement("span");
		previewLabel.className = "preview-card-label";
		previewLabel.textContent = "OUR WISHES PREVIEW";
		actions.append(previewLabel);
	} else {
		actions.append(
			iconButton("card-icon-button", item.received ? "Mark as still wanted" : "Mark as received", "check", () => updateWish(item.id, { received: !item.received })),
			iconButton("card-icon-button delete-button", "Delete wish", "trash", () => deleteWish(item.id))
		);
	}

	content.append(titleRow, note, divider, actions);
	card.append(imageWrap, content);
	return card;
}

function renderCategories(items) {
	const list = element("category-list");
	list.replaceChildren();
	const counts = new Map();
	if (state.account) state.account.categories.forEach((category) => counts.set(category, 0));
	items.forEach((item) => {
		const category = item.category || "Unsorted";
		counts.set(category, (counts.get(category) || 0) + 1);
	});

	for (const [category, count] of counts) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `category-item${state.category === category ? " is-selected" : ""}`;
		const swatch = document.createElement("span");
		swatch.className = "category-swatch";
		const name = document.createElement("span");
		name.textContent = category;
		const number = document.createElement("span");
		number.className = "category-count";
		number.textContent = String(count).padStart(2, "0");
		button.append(swatch, name, number);
		button.addEventListener("click", () => {
			state.category = state.category === category ? "" : category;
			render();
		});
		list.append(button);
	}
}

function renderAccount() {
	const area = element("account-area");
	const topButton = element("top-account");
	area.replaceChildren();

	if (!state.account) {
		const signIn = document.createElement("button");
		signIn.className = "account-card guest-account";
		signIn.type = "button";
		const avatar = document.createElement("span");
		avatar.className = "account-avatar guest-avatar";
		avatar.textContent = "?";
		const copy = document.createElement("span");
		copy.className = "account-copy";
		const name = document.createElement("strong");
		name.textContent = "Just looking?";
		const label = document.createElement("small");
		label.textContent = "Sign in or join";
		copy.append(name, label);
		const arrow = document.createElement("span");
		arrow.className = "account-arrow";
		arrow.textContent = "↗";
		signIn.append(avatar, copy, arrow);
		signIn.addEventListener("click", () => openAuth("login"));
		area.append(signIn);
		setAvatar(topButton, "?", "Sign in or create an account", () => openAuth("login"));
		return;
	}

	const initials = state.account.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "W";
	const profile = document.createElement("div");
	profile.className = "account-card signed-in-account";
	const avatar = document.createElement("span");
	avatar.className = "account-avatar signed-avatar";
	avatar.textContent = initials;
	const copy = document.createElement("span");
	copy.className = "account-copy";
	const name = document.createElement("strong");
	name.textContent = state.account.name;
	const username = document.createElement("small");
	username.textContent = `@${state.account.username || state.account.name}`;
	const signOut = document.createElement("button");
	signOut.className = "sign-out-button";
	signOut.type = "button";
	signOut.textContent = "Sign out";
	signOut.addEventListener("click", signOutAccount);
	copy.append(name, username, signOut);
	profile.append(avatar, copy);
	area.append(profile);
	setAvatar(topButton, initials, `Signed in as ${state.account.name}`, signOutAccount);
}

function setAvatar(button, text, label, onClick) {
	const value = document.createElement("span");
	value.textContent = text;
	button.replaceChildren(value);
	button.setAttribute("aria-label", label);
	button.onclick = onClick;
}

function getVisibleItems() {
	return currentItems().filter((item) => {
		if (state.filter === "received" && !item.received) return false;
		if (state.category && item.category !== state.category) return false;
		const searchText = `${item.title} ${item.category} ${item.note}`.toLowerCase();
		return searchText.includes(state.search.toLowerCase());
	}).sort((first, second) => {
		if (state.sort === "price-low") return Number(first.price) - Number(second.price);
		if (state.sort === "price-high") return Number(second.price) - Number(first.price);
		return Number(second.createdAt) - Number(first.createdAt);
	});
}

function render() {
	const items = currentItems();
	const isPreview = !state.account;
	const visibleItems = getVisibleItems();
	element("wish-grid").replaceChildren(...visibleItems.map((item) => renderCard(item, isPreview)));
	element("wish-grid").hidden = visibleItems.length === 0;
	element("empty-state").hidden = visibleItems.length > 0;
	element("preview-indicator").hidden = !isPreview;
	element("preview-callout").hidden = !isPreview;
	element("all-count").textContent = items.length;
	element("received-count").textContent = items.filter((item) => item.received).length;
	element("tab-all-count").textContent = String(items.length).padStart(2, "0");
	element("tab-received-count").textContent = String(items.filter((item) => item.received).length).padStart(2, "0");
	element("total-number").textContent = String(items.filter((item) => !item.received).length).padStart(2, "0");
	element("active-category-row").hidden = !state.category;
	element("active-category-label").textContent = state.category ? `Showing ${state.category}` : "";
	element("breadcrumb-current").textContent = state.category ? state.category.toUpperCase() : state.filter === "all" ? "ALL WISHES" : "RECEIVED";
	element("page-title").innerHTML = state.account ? "A list of<br><em>lovely maybes.</em>" : "Little things<br><em>worth waiting for.</em>";
	element("welcome-label").textContent = state.account ? `A HAPPY LITTLE LIST FOR ${state.account.name.toUpperCase()}` : "A PLACE FOR YOUR MAYBES";
	element("heading-subtitle").textContent = state.account ? "Keep your someday-soons and absolutely-must-haves in one happy place." : "Keep all your almosts, someday-soons, and absolutely-must-haves in one happy place.";
	element("footer-account-state").textContent = state.account ? `A little joy, saved for ${state.account.name}.` : "A little joy, on the way.";
	element("empty-title").textContent = state.filter === "received" ? "The good things are still on their way." : "Your list, your lovely little universe.";
	element("empty-copy").textContent = state.account ? "Add a wish and give future-you something to look forward to." : "Sign in to start your own list and keep every little maybe in one place.";
	element("empty-action").textContent = state.account ? "Add your first wish +" : "Create your account +";
	element("empty-action").onclick = () => state.account ? openWishForm() : openAuth("signup");
	document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.filter === state.filter));
	renderCategories(items);
	renderAccount();
}

async function updateWish(id, changes) {
	if (!state.account) return;
	if (cloudEnabled) {
		const { error } = await cloud.from("wishlist_items").update({ received: changes.received }).eq("id", id);
		if (error) {
			showToast("Couldn't update that wish. Check your connection and try again.");
			return;
		}
	}
	state.account.items = state.account.items.map((item) => item.id === id ? { ...item, ...changes } : item);
	if (!cloudEnabled) persistAccount();
	render();
	showToast(changes.received === true ? "Marked as received. How lovely." : "Wish updated.");
}

async function deleteWish(id) {
	if (!state.account) return;
	if (cloudEnabled) {
		const { error } = await cloud.from("wishlist_items").delete().eq("id", id);
		if (error) {
			showToast("Couldn't delete that wish. Check your connection and try again.");
			return;
		}
	}
	state.account.items = state.account.items.filter((item) => item.id !== id);
	if (!cloudEnabled) persistAccount();
	render();
	showToast("Wish removed from your list.");
}

function showToast(message) {
	const toast = element("toast");
	toast.textContent = message;
	toast.classList.add("is-visible");
	window.clearTimeout(state.toastTimer);
	state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function openModal(content) {
	element("modal-content").replaceChildren(content);
	element("modal-backdrop").hidden = false;
	document.body.classList.add("modal-open");
	content.querySelector("input, button")?.focus();
}

function closeModal() {
	element("modal-backdrop").hidden = true;
	document.body.classList.remove("modal-open");
}

function field(labelText, name, type, placeholder, required = false) {
	const wrapper = document.createElement("label");
	wrapper.className = "form-field";
	const label = document.createElement("span");
	label.textContent = labelText;
	const input = document.createElement("input");
	input.name = name;
	input.type = type;
	input.placeholder = placeholder;
	input.required = required;
	if (type === "email") input.autocomplete = "email";
	if (name === "name") input.autocomplete = "name";
	if (name === "username") {
		input.autocomplete = "username";
		input.minLength = 3;
		input.maxLength = 24;
		input.pattern = "(?:[A-Za-z0-9._]|-){3,24}";
		input.autocapitalize = "none";
	}
	if (type === "password") {
		input.autocomplete = name === "password" ? "current-password" : "new-password";
		input.minLength = name === "password" && placeholder.startsWith("At least") ? 8 : 1;
	}
	wrapper.append(label, input);
	return wrapper;
}

function openAuth(mode, errorMessage = "") {
	const form = document.createElement("form");
	form.className = "modal-form";
	const heading = document.createElement("h2");
	heading.id = "modal-title";
	heading.textContent = mode === "signup" ? "Make yourself at home." : "Lovely to see you again.";
	const intro = document.createElement("p");
	intro.className = "modal-intro";
	intro.textContent = mode === "signup" ? "Choose a username and password. No email needed." : "Sign in with your username to see your wishes.";
	form.append(heading, intro);
	if (errorMessage) {
		const error = document.createElement("p");
		error.className = "form-error";
		error.setAttribute("role", "alert");
		error.textContent = errorMessage;
		form.append(error);
	}
	form.append(field("Username", "username", "text", "3–24 letters, numbers, . _ -", true));
	form.append(field("Password", "password", "password", mode === "signup" ? "At least 8 characters" : "Your password", true));
	const submit = document.createElement("button");
	submit.className = "primary-button modal-submit";
	submit.type = "submit";
	submit.textContent = mode === "signup" ? "Create my account  ↗" : "Sign in  ↗";
	form.append(submit);
	const switchRow = document.createElement("p");
	switchRow.className = "modal-switch";
	switchRow.append(document.createTextNode(mode === "signup" ? "Already have a list? " : "New around here? "));
	const switchButton = document.createElement("button");
	switchButton.type = "button";
	switchButton.textContent = mode === "signup" ? "Sign in" : "Create an account";
	switchButton.addEventListener("click", () => openAuth(mode === "signup" ? "login" : "signup"));
	switchRow.append(switchButton);
	const notice = document.createElement("p");
	notice.className = "local-notice";
	notice.textContent = cloudEnabled ? "No email needed. Keep your username and password safe; password recovery isn't available." : "Saved in this browser only. Keep your username and password safe; there's no password recovery.";
	form.append(switchRow, notice);
	form.addEventListener("submit", (event) => authenticate(event, mode, form));
	openModal(form);
}

async function hashPassword(password, salt) {
	if (!crypto.subtle) throw new Error("Secure password storage needs a secure browser context. Open this page on localhost.");
	const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" }, material, 256);
	return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(event, mode, form) {
	event.preventDefault();
	const submit = form.querySelector("[type=submit]");
	submit.disabled = true;
	submit.textContent = "One little moment…";
	const values = new FormData(form);
	const username = normalizeUsername(values.get("username"));
	const password = String(values.get("password"));
	try {
		if (cloudEnabled) {
			if (mode === "signup") {
				const { data, error } = await cloud.auth.signUp({
					email: authEmailFor(username),
					password,
					options: { data: { name: username, username } }
				});
				if (error) throw error;
				if (!data.session || !data.user) throw new Error("Turn off email confirmation in Supabase Auth to use username-only registration.");
				await activateCloudAccount(data.user);
			} else {
				const { data, error } = await cloud.auth.signInWithPassword({ email: authEmailFor(username), password });
				if (error) throw error;
				await activateCloudAccount(data.user);
			}
		} else {
		const accounts = readAccounts();
		if (mode === "signup") {
			if (accounts.some((account) => account.username === username || account.email === authEmailFor(username) || account.email?.split("@")[0] === username)) throw new Error("That username is already taken. Try signing in or choose another.");
			const salt = crypto.randomUUID();
			const account = { id: crypto.randomUUID(), name: username, username, email: authEmailFor(username), salt, passwordHash: await hashPassword(password, salt), items: [], categories: [...DEFAULT_CATEGORIES] };
			accounts.push(account);
			writeAccounts(accounts);
			state.account = account;
		} else {
			const account = accounts.find((candidate) => candidate.username === username || candidate.email === authEmailFor(username) || candidate.email?.split("@")[0] === username);
			if (!account || await hashPassword(password, account.salt) !== account.passwordHash) throw new Error("That username and password didn't match. Have another go?");
			account.username ||= username;
			state.account = account;
		}
		}
		if (!cloudEnabled) localStorage.setItem(SESSION_KEY, state.account.id);
		state.filter = "all";
		state.category = "";
		closeModal();
		render();
		showToast(mode === "signup" ? `Welcome to your happy place, ${state.account.name}.` : `Welcome back, ${state.account.name}.`);
	} catch (error) {
		openAuth(mode, error instanceof Error ? error.message : "Something went wrong. Please try again.");
	}
}

async function signOutAccount() {
	if (cloudEnabled) {
		const { error } = await cloud.auth.signOut();
		if (error) {
			showToast("Couldn't sign out. Please try again.");
			return;
		}
		if (state.cloudChannel) await cloud.removeChannel(state.cloudChannel);
		state.cloudChannel = null;
	}
	state.account = null;
	state.filter = "all";
	state.category = "";
	if (!cloudEnabled) localStorage.removeItem(SESSION_KEY);
	render();
	showToast("Signed out. Your list will be here when you return.");
}

function openWishForm() {
	if (!state.account) {
		openAuth("signup");
		return;
	}
	const form = document.createElement("form");
	form.className = "modal-form";
	const heading = document.createElement("h2");
	heading.id = "modal-title";
	heading.textContent = "Add a little maybe.";
	const intro = document.createElement("p");
	intro.className = "modal-intro";
	intro.textContent = "Save the thing. Let the daydreaming continue.";
	form.append(heading, intro, field("What is it?", "title", "text", "A thing you've been thinking about", true));

	const detailRow = document.createElement("div");
	detailRow.className = "form-row";
	const priceField = document.createElement("label");
	priceField.className = "form-field";
	const priceLabel = document.createElement("span");
	priceLabel.textContent = "Harga (IDR)";
	const priceMode = document.createElement("select");
	priceMode.name = "priceMode";
	const unknownPrice = document.createElement("option");
	unknownPrice.value = "unknown";
	unknownPrice.textContent = "— Belum tahu harganya";
	const knownPrice = document.createElement("option");
	knownPrice.value = "known";
	knownPrice.textContent = "Masukkan harga";
	priceMode.append(unknownPrice, knownPrice);
	const priceInput = document.createElement("input");
	priceInput.className = "price-input";
	priceInput.type = "number";
	priceInput.name = "price";
	priceInput.min = "0";
	priceInput.step = "1";
	priceInput.placeholder = "Contoh: 250000";
	priceInput.hidden = true;
	priceMode.addEventListener("change", () => {
		priceInput.hidden = priceMode.value !== "known";
		priceInput.required = priceMode.value === "known";
		if (priceInput.hidden) priceInput.value = "";
	});
	priceField.append(priceLabel, priceMode, priceInput);
	const categoryField = document.createElement("label");
	categoryField.className = "form-field";
	const categoryLabel = document.createElement("span");
	categoryLabel.textContent = "Collection";
	const category = document.createElement("select");
	category.name = "category";
	[...new Set([...state.account.categories, ...state.account.items.map((item) => item.category)].filter(Boolean))].forEach((name) => {
		const option = document.createElement("option");
		option.value = name;
		option.textContent = name;
		category.append(option);
	});
	categoryField.append(categoryLabel, category);
	detailRow.append(priceField, categoryField);
	form.append(detailRow, field("Image URL (optional)", "image", "url", "Kosongkan untuk foto otomatis"), field("A note to future you", "note", "text", "Why this one?"));

	const submit = document.createElement("button");
	submit.className = "primary-button modal-submit";
	submit.type = "submit";
	submit.textContent = "Save this wish  ↗";
	form.append(submit);
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		submit.disabled = true;
		const values = new FormData(form);
		const rawPriceText = String(values.get("price") || "").trim();
		const rawPrice = Number(rawPriceText);
		const title = String(values.get("title")).trim();
		const categoryName = String(values.get("category")) || "Unsorted";
		const wish = {
			title,
			price: values.get("priceMode") === "known" && Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null,
			category: categoryName,
			image: resolveWishImage(String(values.get("image")), title, categoryName),
			note: String(values.get("note")).trim(),
			received: false,
			createdAt: Date.now()
		};
		if (cloudEnabled) {
			const { data, error } = await cloud.from("wishlist_items").insert({
				user_id: state.account.id,
				title: wish.title,
				price: wish.price,
				category: wish.category,
				image_url: wish.image,
				note: wish.note
			}).select().single();
			if (error) {
				submit.disabled = false;
				showToast("Couldn't sync this wish. Check your connection and try again.");
				return;
			}
			state.account.items.unshift(mapCloudWish(data));
		} else {
			wish.id = crypto.randomUUID();
			state.account.items.unshift(wish);
			persistAccount();
		}
		closeModal();
		render();
		showToast("A new little maybe, saved.");
	});
	openModal(form);
}

async function addCategory() {
	if (!state.account) {
		openAuth("signup");
		return;
	}
	const enteredName = window.prompt("Name your new collection:");
	if (!enteredName?.trim()) return;
	const name = enteredName.trim().slice(0, 32);
	if (!state.account.categories.includes(name)) {
		if (cloudEnabled) {
			const { error } = await cloud.from("wishlist_categories").insert({ user_id: state.account.id, name });
			if (error) {
				showToast("Couldn't sync that collection. Try again.");
				return;
			}
		}
		state.account.categories.push(name);
		if (!cloudEnabled) persistAccount();
	}
	render();
	showToast(`“${name}” is ready for something lovely.`);
}

function bindEvents() {
	document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
		state.filter = button.dataset.filter;
		state.category = "";
		render();
	}));
	element("new-wish").addEventListener("click", openWishForm);
	element("add-category").addEventListener("click", addCategory);
	element("callout-signup").addEventListener("click", () => openAuth("signup"));
	element("clear-category").addEventListener("click", () => { state.category = ""; render(); });
	element("search-input").addEventListener("input", (event) => { state.search = event.target.value; render(); });
	element("sort-select").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
	element("modal-close").addEventListener("click", closeModal);
	element("modal-backdrop").addEventListener("click", (event) => { if (event.target === element("modal-backdrop")) closeModal(); });
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeModal();
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			element("search-input").focus();
		}
	});
}

async function initialize() {
	bindEvents();
	if (cloudEnabled) {
		const { data, error } = await cloud.auth.getSession();
		if (error) {
			console.error("Could not restore the Supabase session", error);
			showToast("Couldn't connect to your synced wishlist.");
		} else if (data.session?.user) {
			try {
				await activateCloudAccount(data.session.user);
			} catch (loadError) {
				console.error("Could not load the Supabase wishlist", loadError);
				showToast("Couldn't load your wishlist. Check the Supabase setup.");
			}
		}
		cloud.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_OUT") {
				if (state.cloudChannel) cloud.removeChannel(state.cloudChannel);
				state.cloudChannel = null;
				state.account = null;
				state.filter = "all";
				state.category = "";
				render();
			}
		});
		render();
		return;
	}
	const sessionId = localStorage.getItem(SESSION_KEY);
	state.account = readAccounts().find((account) => account.id === sessionId) || null;
	if (!state.account && sessionId) localStorage.removeItem(SESSION_KEY);
	render();
}

initialize();

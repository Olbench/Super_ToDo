// IIFE - Immediately Invoked Function Expression
// создаем инфраструктуру которую мы будем вызывать
// функции содержащие логику
// набор вспомогательных функций без побочных эффектов (без влияния элементов DOM-дерево)
const utils = (() => {
  // uid() - генерация id с префиксом для сущностей (категорий или задач)
  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${Date.now().toString(36)}_${rnd}`
  }

  // escapeHTML() - для безовасного ввода текста в HTML (js-чувствительные символы)
  function escapeHTML(str) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(str).replace(/[&<>"']/g, (m) => map[m])
  }

  function sortTask(tasks) {
    //сначала делаем копию массива с помощью spread оператора
    return [...tasks].sort((a, b) => {
      if (a.done != b.done) return a.done ? 1 : -1
      return a.createdAt - b.createdAt
    })
  }
  return { uid, escapeHTML, sortTask }
})() //фукция всегда будет вызвана

const validators = (() => {
  function validateCategoryName(categoryName, existingNamesLower) {
    //удаляем лишние символы и пробелы
    const trimmed = String(categoryName || "").trim()
    // проверка на длину
    if (trimmed.length < 2 || trimmed.length > 40)
      return { ok: false, msg: "2 to 40 symbols" }
    // проверка существет ли уже такая категория
    if (existingNamesLower && existingNamesLower.has(trimmed.toLowerCase()))
      return { ok: false, msg: "Category already exists" }
  }

  // удаление лишнего и проверка длины в TaskTitle
  function validateTaskTitle(taskTitle) {
    const trimmed = String(taskTitle || "").trim()
    if (trimmed.length < 2 || trimmed.length > 140)
      return { ok: false, msg: "2 to 140 symbols" }
  }
  return { validateCategoryName, validateTaskTitle }
})()

const storage = (() => {
  const KEY = "todo.v1"
  // Set() - коллекция уникальных значений. в отличие от массива не хранит дубликаты
  // основные операции: Set.add(), Set.delete(), Set.has(), также итерируется с помощью forEach
  // subscribers гарантирует, что одна и та же функция не будет добавлена дважды
  const subscribers = new Set()

  // load() - загрузка состояния из localStorage для безопасности миграции
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      // Вызывает migrate и передаем в нее ничего, таким образом остается в изначальной версии
      if (!raw) return migrate(null)
      const parsed = JSON.parse(raw)
      return migrate(parsed)
    } catch (error) {
      console.error("load error, error")
      return migrate(null)
    }
  }
  //  save(state) - сохранение состояния и оповещения подписчиков (подписчики - категории или задачи зависящие от состояний)
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      subscribers.forEach((fnItem) => fnItem(state))
    } catch (error) {
      console.error("save error, error")
    }
  }

  // subscribe(fn) - подписка на сохранение состояния (.add), возвращает функцию для отписки
  function subscribe(fn) {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  }

  // migrate(raw) - структурирует данные до актуальной версии
  function migrate(raw) {
    if (!raw) {
      return {
        meta: { version: 1, collapsedByCategoryId: {} },
        categories: [],
        tasks: [],
      }
    }
    if (!raw.meta || raw.meta.version !== 1) {
      raw.meta = {
        version: 1,
        collapsedByCategoryId:
          (raw.meta && raw.meta.collapsedByCategoryId) || {},
      }
    }
    return raw
  }
  return { load, save, subscribe, migrate }
})()

const model = () => {
  //бизнес логика, операции над состоянием (обновлениеб удаление)
  let state = storage.load()

  // проверка текущего состояния из localStorage
  function getState() {
    return state
  }

  // установка состояние
  function setState(next) {
    state = next
    storage.save(state)
  }

  // получение отсортированного списка категорий от нового к старому
  function getCategories() {
    return [...state.categories].sort((a, b) => a.order - b.order)
  }

  // функция получает задачи для конткретной категории (фильтрует по параметру categoryId) с последующей сортировкой
  function getTasksByCategories(categoryId) {
    return utils.sortTask(
      state.tasks.filter((item) => item.categoryId === categoryId)
    )
  }

  // функция добавляет новую категорию с валидацией уникальности и длины
  function addCategory(name) {
    const names = new Set(
      state.categories.map((item) => item.name.toLowerCase())
    )
    const v = validators.validateCategoryName(name, names)
    if (!v.ok) return v
    const id = utils.uid("cat")
    const cat = {
      id,
      name: name.trim(),
      createdAt: Date.now(),
      order: state.categories.length,
    }
    setState({ ...state, categories: [...state.categories, cat] })
    return { ok: true, id }
  }
  function renameCategory(id, name) {
    const names = new Set(
      state.categories
        .filter((item) => item.id !== id) // удаление елемента
        .map((item) => item.name.toLowerCase())
    )
    const v = validators.validateCategoryName(name, names)
    if (!v.ok) return v
    const cat = state.categories.map((item) =>
      item.id === id ? { ...item, name: name.trim() } : item
    )
    setState({ ...state, cat })
    return { ok: true }
  }

  function removeCategory(id) {
    // работа с кнопкой Удалить категорию
    const categories = state.categories.filter((item) => item.id !== id)
    // categoryId - это id category под которую создается tasks
    const tasks = state.tasks.filter((item) => item.categoryId !== id)
    const meta = { ...state.meta } // не позволяет новому елементу занять место удаленного и иметь развернутое состояние
    delete meta.collapsedByCategoryId[id]

    setState({ ...state, categories, tasks, meta })
    return { ok: true }
  }

  function addTask(categoryId, title) {
    const v = validators.validateTaskTitle(title)
    if (!v.ok) return v
    const id = utils.uid("task")
    const task = {
      id,
      categoryId,
      title: title.trim(),
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setState({ ...state, tasks: [...state.tasks, task] })
    return { ok: true, id }
  }
  function toggleTask(id) {
    const tasks = state.tasks.map((item) =>
      item.id === id ? { ...item, done: !done, updatedAt: Date.now() } : item
    )

    setState({ ...state, tasks })
    return { ok: true }
  }
  function renameTask(id, title) {
    const v = validators.validateTaskTitle(title)
    if (!v.ok) return v
    const task = state.tasks.map((item) =>
      item.id === id
        ? { ...item, title: title.trim(), updatedAt: Date.now() }
        : item
    )
    setState({ ...state, task })
    return { ok: true }
  }
  function removeTask(id) {
    const task = state.tasks.filter((item) => item.id !== id)

    setState({ ...state, task })
    return { ok: true }
  }
  function setCollapsed(categoryId, collapsed) {
    setState({
      ...state,
      meta: {
        ...state.meta,
        collapsedByCategoryId: {
          ...state.meta.collapsedByCategoryId,
          [categoryId]: !!collapsed, //логическое отрицание
        },
      },
    })
  }

  return {
    getState,
    setState,
    getCategories,
    getTasksByCategories,
    addCategory,
    renameCategory,
    removeCategory,
    addTask,
    toggleTask,
    renameTask,
    removeTask,
    setCollapsed,
  }
}

const view = () => {
  const elm = {
    categoryList: document.querySelector("#categoryList"),
    selectCategory: document.querySelector("#selectCategory"),
    deleteCategory: document.querySelector("#deleteCategory"),
    btnDeleteCategory: document.querySelector("#btnDeleteCategory"),
    inputNewCategory: document.querySelector("#newCategory"),
    btnCreateCategory: document.querySelector("#btnCreateCategory"),
    newTask: document.querySelector("#newTask"),
    btnCreateTask: document.querySelector("#btnCreateTask"),
  }
  // рендер панели управления (доступность кнопки)
  // отображает первичн сост-я эл-тов
  // in the middle of figma
  function renderControls(state) {
    //drop-downs
    const options = model.getCategories().map((item) => `<option value="${item.id}">${utils.escapeHTML(item.name)}</option>`)
    elm.selectCategory.innerHTML = options.length ? `option value="" disabled>Choose category</option> ${options.join("")}` : `option value="" disabled>No categories</option>`
    //{options.join("")} to join 3 or more lines in arr [of lines]
    elm.deleteCategory.innerHTML = options.length ? `option value="" disabled>Choose category</option> ${options.join("")}` : `option value="" disabled>No categories</option>`
    elm.btnDeleteCategory.disabled = !model.getCategories().length
  }
  //рендер списка категорий
  function renderCategoryList() {
    const categories = model.getCategories()
    if (!categories.length) {
      elm.categoryList.innerHTML = ''
      return
    }
    elm.categoryList.innerHTML = categories.map(renderCategory).join('')
  }

  //шаблон одной категории с задачами
  function renderCategory(category) {
    const collapsed =
      !!model.getState().meta.collapsedByCategoryId[category.id]
    //это сост-е нащей отрендер=ой кат-ии в зависи-ти от соc-я collapsed
    //не не true вернет true - это двлйное отриц-е
    const tasks = model.getTasksByCategories(category.id)
    const bodyHidden = collapsed ? " hidden" : ""
    const expanded = collapsed ? "false" : "true"
    return `
      <article class="category" data-id="${category.id}">
        <header class="category_header">
          <h2 class="category_title" data-role="cat_title">${utils.escapeHTML(
      category.name
    )}</h2>
          <div class="category_actions">
            <button class="btn btn-ghost" data-action="rename_cat" aria-label="rename category"><img src="./icons/edit.svg" alt="edit"></button>
             <button class="btn btn-ghost" data-action="toggle" aria-expanded="${expanded}" aria-controls="body_${category.id
      }"><img src="./icons/down-white.svg" alt="toggle"></button>
          </div>
          <div class="category_body" ${bodyHidden} id="body_${category.id}">
            <ul class="task_list">${tasks.map(renderTask).join("")}</ul>
          </div>
        </header>
      </article>
    `
  }
  //шаблон одной строки с задачей
  function renderTask(task) {
    const doneClass = task.done ? " task-done" : ""
    return `
    <li class="task${doneClass}" data-id="${task.id}">
  <input class="task-check" type="checkbox" ${task.done ? "checked" : ""
      } aria-label="checked done">
  <div class="task-title" data-role="task-title"> ${utils.escapeHTML(task.title)}</div> 
  <div class="task-actions"></div>
  <button class="btn btn-ghost" data-action="rename_task" aria-label="rename task"><img src="./icons/edit.svg" alt="edit"></button>
  <button class="btn btn-ghost" data-action="delete_task" aria-label="delete task"><img src="./icons/delete.svg" alt="toggle"></button>
</li>
    `
  }
  //точечно переписать одну категорию по id
  function updateCategory(id) {
    const cat = model.getCategories().find((item) => item.id === id)
    const node = elm.categoryList.querySelector(`.category[data-id="${id}"]`)
    //реализует поиск нужн эл-та в списке по атрибуту data-id
    //`.category[data-id="${id}"]` это класс
    if (!cat || !node) {
      return renderCategoryList(model.getState())
    }
    node.outerHTML = renderCategory(cat)
    //html распр-ся на каких-то потомков !!! надо загуглить
  }

  //переписать одну задачу по id по узлу (весь элемент)
  function updateTaskRow(id) {
    const task = model.getState().find((item) => item.id === id)
    const node = elm.categoryList.querySelector(`.task[data-id="${id}"]`)
    //реализует поиск нужн эл-та в списке по атрибуту data-id
    //`.task[data-id="${id}"]` это класс
    if (!task || !node) {
      return renderCategoryList(model.getState())
    }
    node.outerHTML = renderTask(task)
  }

  return {
    renderControls,
    renderCategoryList,
    renderCategory,
    renderTask,
    updateCategory,
    updateTaskRow,
  }
}

// взаимодействие пользовательский действий с моделью (бизнес-логикой) и представлением
const controller = (() => {
  const { elm } = view // то же самое, что и "const elm = view.elm"
  // первичный рендер, биндинг обработчиков (связать логику обработчиков) и подписка на Storage
  function init() {
    view.renderControls(model.getState())
    view.renderCategoryList(model.getState())
    bindFormCreateCategory()
    bindFormAddTask()
    bindFormRemoveCategory()
    bindListHandlers()
    inlineRenameCategory()
    inlineRenameTask()
    bindWipeAll()
    storage.subscribe((st) => {
      view.renderControls(st)
    })
  }

  // обработчик формы создания категории (валидаци + submit)
  function bindFormCreateCategory() {
    const input = elm.inputNewCategory
    const btn = elm.btnCreateCategory
    const error = document.querySelector('#newCategoryError')
    const createCategory = document.querySelector('#formCreateCategory')
    input.addEventListener('input', () => {
      const names = new Set(model.getState().categories.map((item) => item.name.toLowerCase())) //создание коллекции уникальных категорий возведенных в нижний регистр
      const v = validators.validateCategoryName(input.value, names) //проверка на сущствование элемента в списке категорий
      error.textContent = v.ok ? '' : v.msg
      btn.disabled = !v.ok
    })
    createCategory.addEventListener('submit', (event) => {
      event.preventDefault()
      const res = model.addCategory(input.value)
      if (!res.ok) return
      input.value = ''
      btn.disabled = true
      view.renderControls(model.getState())
      view.renderCategoryList(model.getState())
    })
  }
  // обработчик формы добавления задачи (валидация поля + выбор категории)
  function bindFormAddTask() {
    const title = elm.newTask
    const btn = elm.btnCreateTask
    const error = document.querySelector('#newTaskError')
    const createTask = document.querySelector('#formAddTask')
    title.addEventListener('input', () => {
      const v = validators.validateTaskTitle(title.value)
      error.textContent = v.ok ? '' : v.msg
      btn.disabled = !v.ok || !elm.selectCategory.value
    })
    elm.selectCategory.addEventListener('change', () => {
      const v = validators.validateTaskTitle(title.value)
      btn.disabled = !v.ok || !elm.selectCategory.value
    })
    createTask.addEventListener('submit', (event) => {
      event.preventDefault()
      const catId = elm.selectCategory.value
      if (!catId) return
      const res = model.addTask(catId, title.value)
      if (!res.ok) return
      title.value = ''
      btn.disabled = true
      view.updateCategory(catId)
    })
  }
  // обработчик удаления категории (подтверждение + обновление UI)
  function bindFormRemoveCategory() {
    const formRemoveCategory = document.querySelector('#formRemoveCategory')
    formRemoveCategory.addEventListener('submit', (e) => {
      e.preventDefault()
      const id = elm.deleteCategory.value
      if (!id) return
      const cat = model.getState().categories.find((item) => item.id === id) //поиск удаляемой категории 
      const count = model.getState().tasks.filter(item => item.categoryId === id).length //счетчик удаляемых категорий и тасков
      const msg = count ? `Удалить "${cat.name}" и ${count} задач` : `Удалить "${cat.name}"` //отображение модального окна подтверждения
      ui.confirm(msg).then((res) => {
        if (!res) return
        model.removeCategory(id)
        view.renderControls(model.getState())
        view.renderCategoryList(model.getState())
      })
    })
  }

  //делегирование событий в списке (сворачивание, переименование, удаление состояний checkbox)
  function bindListHandlers() {
    const catlist = document.querySelector('#categoryList')
    catlist.addEventListener('click', (e) => {
      const target = e.target
      const catNode = target.closest('.category')
      if (!catNode) return
      const catId = catNode.getAttribute('data-id')
      if (target.mathes('[data-action="toggle"]')) {
        const body = catNode.querySelector('.category_body')
        const btn = target
        const willCollapsed = !body.hasAttribute('hidden')
        body.toggleAtribute('hidden')
        btn.setAtribute('aria-expanded', body.hasAttribute('hidden') ? 'false' : 'true')
        model.setCollapsed(catId, willCollapsed)
      }
      if (target.mathes('[data-action="rename_cat"]')) {
        inlineRenameCategory(catId, catNode)
      }
      if (target.mathes('[data-action="rename_task"]')) {
        const taskId = target.closest('.task').getAttribute('data-id')
        inlineRenameTask(taskId)
      }
      if (target.mathes('[data-action="delete_task"]')) {
        const taskId = target.closest('.task').getAttribute('data-id')
        const task = model.getState().tasks.find((item) => item.id === taskId)
        model.toggleTask(taskId)
        view.updateCategory(task.categoryId)
      }
      catlist.addEventListener('change', (e) => {
        const target = e.target
        if (target.mathes('.task_check')) {
          const taskId = target.closest('.task').getAttribute('data-id')
          const task = model.getState().tasks.find((item) => item.id === taskId)
          model.toggleTask(taskId)
          view.updateCategory(task.categoryId)
        }
      })
    })
  }
  // inline переименование категории (замена заголовка категории на input с валидацией)
  function inlineRenameCategory(catId, catNode) {
    const titleElem = catNode.querySelector('[data-role=cat_title]')
    const initial = titleElem.textContent
    const input = document.createElement('input')
    input.className = 'input'
    input.value = initial
    input.setAttribute('aria-label', 'Переименовать категорию')
    titleElem.replaceWith(input)
    const finish = (save) => {
      if (save) {
        const res = model.renameCategory(catId, input.value)
        if (!res.ok) {
          input.setCustomValidity(res.msg)
          input.reportValidity()
          return
        }
      }
      view.updateCategory(catId)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
  }

  // inline переименование заголовка задачи (с сохранением)
  function inlineRenameTask(taskId) {
    const row = document.querySelector(`.task[data-id="${taskId}"]`)
    const titleElem = row.querySelector('[data-role="task-title"]')
    const initial = titleElem.textContent
    const input = document.createElement('input')
    input.className = 'input'
    input.value = initial
    input.setAttribute('aria-label', 'Переименовать категорию')
    titleElem.replaceWith(input)
    const task = model.getState().tasks.find(item => item.id === taskId)
    
    const finish = (save) => {
      if (save) {
        const res = model.renameTask(taskId, input.value)
        if (!res.ok) {
          input.setCustomValidity(res.msg)
          input.reportValidity()
          return
        }
      }
      view.updateCategory(task.categoryId)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
  }

  // сбросить всё
  function bindWipeAll() {
    const wipeAll = document.querySelector('#wipeAll')
    wipeAll.addEventListener('click', async () => {
      const ok = await ui.confirm('Сбросить все данные?')
      if (!ok) return
      const empty = storage.migrate(null)
      localStorage.setItem('todo.v1', JSON.stringify(empty))
      location.reload()
    })
  }

  return { init }
})()

// небольшие вспомогательные функции интерфейса (баннеры, вспомогательные функции)
const ui = () => {
  const banner = document.getElementById('errorBanner')
  const modal = document.getElementById('confirmModal')
  const msgEl = document.getElementById('confirmMessage')
  const yes = document.getElementById('confirmYes')
  const no = document.getElementById('confirmNo')
  // подтверждение и вернуть Promise
  function confirm(msg) {
    msgEl.textContent = msg
    modal.hidden = false
    return new Promise((resolve) => {
      function done(value){
        modal.hidden = true.hidden
        yes.removeEventListener('click', onYes)
        no.removeEventListener('click', onNo)
        modal.removeEventListener('keydown', onKey)
        resolve(value)
      }
      function onYes(){
        done(true)
      }
      function onNo(){
        done(false)
      }
      function onKey(e){
        if(e.key === 'Escape') done(false)
      }
      yes.addEventListener('click', onYes)//передаем ф-ю в виду параметра 
      no.addEventListener('click', onNo)
      modal.addEventListener('keydown', onKey)

      yes.focus()


    })
  }
  // показать баннер
  function showBanner(text) {
    banner.textContent = text
    banner.hidden = false
    setTimeout(() => {
      banner.hidden = true
    },3000)
  }

  return { confirm, showBanner };
};

document.addEventListener("DOMContentLoaded", () => {
  controller.init()
})
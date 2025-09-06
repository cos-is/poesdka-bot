// Вспомогательные функции для логики водителя
export function paginate(array, page, pageSize) {
  return array.slice(page * pageSize, (page + 1) * pageSize);
}

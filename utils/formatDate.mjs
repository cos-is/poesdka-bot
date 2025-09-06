export const formatDate = (date) => {
  let formattedDate = date
  if (typeof date === 'object') {
    formattedDate = date.toISOString().slice(0,10)
  }
  return formattedDate.split('-').reverse().join('.')
}

export const formatTime = (time) => {
  const splittedTime = time.split(':')
  return `${splittedTime[0]}:${splittedTime[1]}`
}

export const getDate = () => {
  const date = new Date()
  date.setTime(date.getTime() + (3 * 60 * 60 * 1000))
  return date
}
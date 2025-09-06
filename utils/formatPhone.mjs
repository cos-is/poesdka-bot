export const formatPhone = phone => {
  return phone.charAt(0) === '7' ? `+${phone}` : phone
}
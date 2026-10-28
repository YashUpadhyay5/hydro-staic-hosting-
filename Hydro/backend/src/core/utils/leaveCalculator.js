function calculateEarnedLeaves(joiningDateInput) {
  if (!joiningDateInput) return 0;
  const joinDate = new Date(joiningDateInput);
  if (isNaN(joinDate.getTime())) return 0;
  const today = new Date();
  
  let months = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());
  if (today.getDate() < joinDate.getDate()) {
    months--;
  }
  return Math.max(0, months);
}

module.exports = { calculateEarnedLeaves };

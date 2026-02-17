// middleware/auth.js
function protectAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.redirect('/login');
}

function protectLeader(req, res, next) {
  if (req.session && req.session.leader) {
    return next();
  }
  return res.redirect('/leader/login');
}

module.exports = { protectAdmin, protectLeader };
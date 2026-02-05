// {
//   "rules": {
//     ".read": "auth != null",
//     ".write": "auth != null",

//     "users": {
//       ".read": "auth != null",

//       ".write": 
//         "auth != null &&
//          root.child('users').child(auth.uid).child('role').val() === 'chief-admin'"
//     },

//     "farmers": {
//       ".read": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||

//           root.child('users')
//               .child(auth.uid)
//               .child('allowedProgrammes')
//               .child(data.child('programme').val())
//               .val() === true
//         )",

//       ".write": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||
//           root.child('users').child(auth.uid).child('role').val() === 'admin' ||
//          root.child('users').child(auth.uid).child('role').val() === 'mobile'
//         )",

//       ".indexOn": ["programme"]
//     },

//     "fodderFarmers": {
//       ".read": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||

//           root.child('users')
//               .child(auth.uid)
//               .child('allowedProgrammes')
//               .child(data.child('programme').val())
//               .val() === true
//         )",

//       ".write": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||
//           root.child('users').child(auth.uid).child('role').val() === 'admin' ||
//          root.child('users').child(auth.uid).child('role').val() === 'mobile'
//         )",

//       ".indexOn": ["programme"]
//     },

//     "capacityBuilding": {
//       ".read": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||

//           root.child('users')
//               .child(auth.uid)
//               .child('allowedProgrammes')
//               .child(data.child('programme').val())
//               .val() === true
//         )",

//       ".write": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||
//           root.child('users').child(auth.uid).child('role').val() === 'admin' ||
//          root.child('users').child(auth.uid).child('role').val() === 'mobile'
//         )",

//       ".indexOn": ["programme"]
//     },

//     "offtakes": {
//       ".read": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||

//           root.child('users')
//               .child(auth.uid)
//               .child('allowedProgrammes')
//               .child(data.child('programme').val())
//               .val() === true
//         )",

//       ".write": "auth != null &&
//         (
//           root.child('users').child(auth.uid).child('role').val() === 'chief-admin' ||
//           root.child('users').child(auth.uid).child('role').val() === 'admin' ||
//          root.child('users').child(auth.uid).child('role').val() === 'mobile'
//         )",

//       ".indexOn": ["programme"]
//     }
//   }
// }


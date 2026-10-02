#ifndef _SIM_OPTIMIZERS_H_
#define _SIM_OPTIMIZERS_H_

#define likely(cond) __builtin_expect(!!(cond), 1)
#define unlikely(cond) __builtin_expect(!!(cond), 0)

#endif  // _SIM_OPTIMIZERS_H_

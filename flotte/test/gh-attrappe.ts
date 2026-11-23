// A stand-in for `gh` for tests that start the whole program (test/mission-prozess.test.ts): it
// answers from memory like forge() in epic-fixture.ts, but as a program of its own, put on PATH.
// bun test/gh-attrappe.ts issue view 69 --repo o/r --json labels

const args = process.argv.slice(2);
const [a, b] = args;
const nach = (name: string) => args[args.indexOf(name) + 1];

if (a === 'label' && b === 'list') console.log('[]');
else if (a === 'issue' && b === 'view') {
  const json = nach('--json');
  console.log(JSON.stringify(json === 'labels' ? { labels: [] } : json === 'comments' ? { comments: [] } : json === 'title' ? { title: 'Ticket' } : { body: '' }));
} else if (a === 'pr' && b === 'list') console.log('[]');
else if (a === 'pr' && b === 'create') console.log('https://example.invalid/o/r/pull/100');
// label create, issue edit, issue comment: nothing to answer

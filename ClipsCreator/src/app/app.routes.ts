import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Editor } from './editor/editor';

export const routes: Routes = [
    { path: '', component: Home },
    { path: 'Editor', component: Editor },
];